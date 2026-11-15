//! The MP4 file, written here: an H.264 video track, an optional AAC track and chapters, with the movie box before
//! the media (`faststart`) so players start before the whole file is there. Chapters are written both ways ffmpeg
//! writes them: a QuickTime text track that the other tracks name with `chap` (QuickTime and Safari read this) and
//! a Nero `chpl` box in the movie's user data (VLC and ffprobe read that).
//!
//! [`read`] parses what [`write`] writes back: the tests, and `mr-cast-engine probe`, use it.

use std::io::Write;

/// The movie's own timescale: milliseconds.
const MOVIE_SCALE: u32 = 1000;

/// One sample of a track: its bytes, its duration in the track's timescale, and whether decoding can start at it.
pub struct Sample<'a> {
    pub data: &'a [u8],
    pub duration: u32,
    pub sync: bool,
}

pub struct Video<'a> {
    pub width: u32,
    pub height: u32,
    /// Ticks a second of the sample durations.
    pub timescale: u32,
    pub sps: &'a [u8],
    pub pps: &'a [u8],
    pub samples: Vec<Sample<'a>>,
}

pub struct Audio<'a> {
    pub rate: u32,
    pub channels: u16,
    pub bitrate: u32,
    /// The AudioSpecificConfig.
    pub config: &'a [u8],
    /// Access units of 1024 samples.
    pub frames: Vec<&'a [u8]>,
    /// Samples before the first one to play (the encoder's delay), and how many to play.
    pub skip: u32,
    pub play: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Chapter {
    pub start_ms: u64,
    pub end_ms: u64,
    pub title: String,
}

/// A box: its type and its body, which the size goes in front of.
fn bx(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(body.len() + 8);
    out.extend((body.len() as u32 + 8).to_be_bytes());
    out.extend(kind);
    out.extend(body);
    out
}

/// A full box: a box whose body starts with a version and flags.
fn full(kind: &[u8; 4], version: u8, flags: u32, body: &[u8]) -> Vec<u8> {
    let mut b = vec![version];
    b.extend(&flags.to_be_bytes()[1..]);
    b.extend(body);
    bx(kind, &b)
}

/// Writes big-endian integers into a body.
trait Put {
    fn u8(&mut self, v: u8) -> &mut Self;
    fn u16(&mut self, v: u16) -> &mut Self;
    fn u32(&mut self, v: u32) -> &mut Self;
    fn u64(&mut self, v: u64) -> &mut Self;
    fn bytes(&mut self, v: &[u8]) -> &mut Self;
}

impl Put for Vec<u8> {
    fn u8(&mut self, v: u8) -> &mut Self {
        self.push(v);
        self
    }
    fn u16(&mut self, v: u16) -> &mut Self {
        self.extend(v.to_be_bytes());
        self
    }
    fn u32(&mut self, v: u32) -> &mut Self {
        self.extend(v.to_be_bytes());
        self
    }
    fn u64(&mut self, v: u64) -> &mut Self {
        self.extend(v.to_be_bytes());
        self
    }
    fn bytes(&mut self, v: &[u8]) -> &mut Self {
        self.extend_from_slice(v);
        self
    }
}

/// The identity matrix of mvhd and tkhd.
const MATRIX: [u32; 9] = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x4000_0000];

/// A track as the writer lays it out.
struct Track<'a> {
    id: u32,
    handler: &'a [u8; 4],
    handler_name: &'a str,
    timescale: u32,
    samples: Vec<Sample<'a>>,
    /// The sample description (avc1, mp4a or text).
    entry: Vec<u8>,
    /// The media header box (vmhd, smhd or gmhd).
    media_header: Vec<u8>,
    /// tkhd: enabled (1) and in the movie (2); chapters are in the movie but not shown.
    flags: u32,
    volume: u16,
    size: (u32, u32),
    /// Media time where playing starts, and how long it plays in the movie's timescale.
    edit: (u64, u64),
    chapters: Option<u32>,
    /// A chunk holds samples until it lasts this long in the track's timescale.
    chunk: u64,
}

impl Track<'_> {
    fn media_duration(&self) -> u64 {
        self.samples.iter().map(|s| s.duration as u64).sum()
    }

    /// The samples grouped into chunks: (first sample, count, start time in seconds).
    fn chunks(&self) -> Vec<(usize, usize, f64)> {
        let mut out = Vec::new();
        let (mut t, mut start, mut first) = (0u64, 0u64, 0usize);
        for (i, s) in self.samples.iter().enumerate() {
            t += s.duration as u64;
            if t - start >= self.chunk || i + 1 == self.samples.len() {
                out.push((first, i + 1 - first, start as f64 / self.timescale as f64));
                first = i + 1;
                start = t;
            }
        }
        out
    }
}

/// The video track's sample description: avc1 with its avcC.
fn avc1(v: &Video) -> Vec<u8> {
    let mut avcc = Vec::new();
    avcc.u8(1).bytes(&v.sps[1..4]).u8(0xff).u8(0xe1).u16(v.sps.len() as u16).bytes(v.sps);
    avcc.u8(1).u16(v.pps.len() as u16).bytes(v.pps);
    if matches!(v.sps[1], 100 | 110 | 122 | 144) {
        // High profiles: 4:2:0, 8 bits, no SPS extensions.
        avcc.u8(0xfc | 1).u8(0xf8).u8(0xf8).u8(0);
    }
    let mut b = Vec::new();
    b.bytes(&[0; 6]).u16(1).bytes(&[0; 16]).u16(v.width as u16).u16(v.height as u16);
    b.u32(0x0048_0000).u32(0x0048_0000).u32(0).u16(1);
    let mut name = [0u8; 32];
    let label = b"mr-cast H.264";
    name[0] = label.len() as u8;
    name[1..=label.len()].copy_from_slice(label);
    b.bytes(&name).u16(0x18).u16(0xffff);
    b.bytes(&bx(b"avcC", &avcc));
    // The colours encode::yuv420 makes: BT.709 primaries, sRGB transfer, BT.601 matrix, limited range.
    let mut colr = b"nclx".to_vec();
    colr.u16(1).u16(13).u16(6).u8(0);
    b.bytes(&bx(b"colr", &colr));
    b.bytes(&bx(b"pasp", &[0, 0, 0, 1, 0, 0, 0, 1]));
    bx(b"avc1", &b)
}

/// A descriptor of the MPEG-4 systems layer, its length in one byte.
fn descriptor(tag: u8, body: &[u8]) -> Vec<u8> {
    let mut out = vec![tag, body.len() as u8];
    out.extend(body);
    out
}

/// The audio track's sample description: mp4a with its esds.
fn mp4a(a: &Audio, track: u32) -> Vec<u8> {
    let mut dc = Vec::new();
    dc.u8(0x40).u8(0x15).bytes(&[0, 0x18, 0]).u32(a.bitrate).u32(a.bitrate);
    dc.bytes(&descriptor(5, a.config));
    let mut es = Vec::new();
    es.u16(track as u16).u8(0).bytes(&descriptor(4, &dc)).bytes(&descriptor(6, &[2]));
    let mut b = Vec::new();
    b.bytes(&[0; 6]).u16(1).u16(0).u16(0).u32(0).u16(a.channels).u16(16).u16(0).u16(0).u32(a.rate << 16);
    b.bytes(&full(b"esds", 0, 0, &descriptor(3, &es)));
    bx(b"mp4a", &b)
}

/// The chapter track's sample description, a QuickTime text entry as ffmpeg writes it.
fn text_entry() -> Vec<u8> {
    // Data reference 1, display flags 1, no colours or text box, font 1; then a font table naming font 1.
    let mut b = vec![0u8; 38];
    (b[7], b[11], b[31]) = (1, 1, 1);
    b.bytes(&bx(b"ftab", &[0, 1, 0, 1, 0]));
    bx(b"text", &b)
}

/// A chapter's text sample: the title's length and bytes, then an encoding box saying UTF-8.
fn text_sample(title: &str) -> Vec<u8> {
    let t = &title.as_bytes()[..title.len().min(u16::MAX as usize)];
    let mut b = Vec::new();
    b.u16(t.len() as u16).bytes(t).bytes(&bx(b"encd", &[0, 0, 1, 0]));
    b
}

fn stts(samples: &[Sample]) -> Vec<u8> {
    let mut runs: Vec<(u32, u32)> = Vec::new();
    for s in samples {
        match runs.last_mut() {
            Some((n, d)) if *d == s.duration => *n += 1,
            _ => runs.push((1, s.duration)),
        }
    }
    let mut b = Vec::new();
    b.u32(runs.len() as u32);
    for (n, d) in runs {
        b.u32(n).u32(d);
    }
    full(b"stts", 0, 0, &b)
}

/// The sample table: descriptions, durations, sync samples, chunks and where they are.
fn stbl(t: &Track, offsets: &[u64], wide: bool) -> Vec<u8> {
    let mut b = full(b"stsd", 0, 0, &[&1u32.to_be_bytes()[..], &t.entry].concat());
    b.extend(stts(&t.samples));
    if t.samples.iter().any(|s| !s.sync) {
        let sync: Vec<u32> = (1..=t.samples.len() as u32).filter(|&i| t.samples[i as usize - 1].sync).collect();
        let mut s = Vec::new();
        s.u32(sync.len() as u32);
        for i in sync {
            s.u32(i);
        }
        b.extend(full(b"stss", 0, 0, &s));
    }
    let chunks = t.chunks();
    let mut runs: Vec<(u32, u32)> = Vec::new();
    for (i, &(_, n, _)) in chunks.iter().enumerate() {
        if runs.last().is_none_or(|r| r.1 != n as u32) {
            runs.push((i as u32 + 1, n as u32));
        }
    }
    let mut s = Vec::new();
    s.u32(runs.len() as u32);
    for (first, n) in runs {
        s.u32(first).u32(n).u32(1);
    }
    b.extend(full(b"stsc", 0, 0, &s));
    let mut s = Vec::new();
    s.u32(0).u32(t.samples.len() as u32);
    for x in &t.samples {
        s.u32(x.data.len() as u32);
    }
    b.extend(full(b"stsz", 0, 0, &s));
    let mut s = Vec::new();
    s.u32(offsets.len() as u32);
    for &o in offsets {
        if wide {
            s.u64(o)
        } else {
            s.u32(o as u32)
        };
    }
    b.extend(full(if wide { b"co64" } else { b"stco" }, 0, 0, &s));
    bx(b"stbl", &b)
}

fn trak(t: &Track, offsets: &[u64], wide: bool) -> Vec<u8> {
    let mut h = Vec::new();
    h.u32(0).u32(0).u32(t.id).u32(0).u32(t.edit.1 as u32).bytes(&[0; 8]).u16(0).u16(0).u16(t.volume).u16(0);
    for m in MATRIX {
        h.u32(m);
    }
    h.u32(t.size.0 << 16).u32(t.size.1 << 16);
    let mut b = full(b"tkhd", 0, t.flags, &h);
    let mut e = Vec::new();
    e.u32(1).u32(t.edit.1 as u32).u32(t.edit.0 as u32).u32(0x10000);
    b.extend(bx(b"edts", &full(b"elst", 0, 0, &e)));
    if let Some(id) = t.chapters {
        b.extend(bx(b"tref", &bx(b"chap", &id.to_be_bytes())));
    }
    let mut m = Vec::new();
    // Language "und".
    m.u32(0).u32(0).u32(t.timescale).u32(t.media_duration() as u32).u16(0x55c4).u16(0);
    let mut mdia = full(b"mdhd", 0, 0, &m);
    let mut hd = Vec::new();
    hd.u32(0).bytes(t.handler).bytes(&[0; 12]).bytes(t.handler_name.as_bytes()).u8(0);
    mdia.extend(full(b"hdlr", 0, 0, &hd));
    let mut minf = t.media_header.clone();
    minf.extend(bx(b"dinf", &full(b"dref", 0, 0, &[&1u32.to_be_bytes()[..], &full(b"url ", 0, 1, &[])].concat())));
    minf.extend(stbl(t, offsets, wide));
    mdia.extend(bx(b"minf", &minf));
    b.extend(bx(b"mdia", &mdia));
    bx(b"trak", &b)
}

/// The Nero chapter list: start times in 100 ns units and titles of up to 255 bytes.
fn chpl(chapters: &[Chapter]) -> Vec<u8> {
    let mut b = Vec::new();
    b.u32(0).u8(chapters.len().min(255) as u8);
    for c in chapters.iter().take(255) {
        let mut end = c.title.len().min(255);
        while !c.title.is_char_boundary(end) {
            end -= 1;
        }
        b.u64(c.start_ms * 10_000).u8(end as u8).bytes(&c.title.as_bytes()[..end]);
    }
    full(b"chpl", 1, 0, &b)
}

fn ms(ticks: u64, scale: u32) -> u64 {
    (ticks * MOVIE_SCALE as u64).div_ceil(scale as u64)
}

/// Writes the MP4 to `out`.
pub fn write(out: &mut impl Write, video: Video, audio: Option<Audio>, chapters: &[Chapter]) -> std::io::Result<()> {
    let text_samples: Vec<Vec<u8>> = chapters.iter().map(|c| text_sample(&c.title)).collect();
    let mut tracks = Vec::new();
    let next = |tracks: &Vec<Track>| tracks.len() as u32 + 1;
    let chapter_id = (!chapters.is_empty()).then(|| 2 + audio.is_some() as u32);
    let v_duration: u64 = video.samples.iter().map(|s| s.duration as u64).sum();
    tracks.push(Track {
        id: 1,
        handler: b"vide",
        handler_name: "VideoHandler",
        timescale: video.timescale,
        entry: avc1(&video),
        media_header: full(b"vmhd", 0, 1, &[0; 8]),
        flags: 3,
        volume: 0,
        size: (video.width, video.height),
        edit: (0, ms(v_duration, video.timescale)),
        chapters: chapter_id,
        chunk: video.timescale as u64,
        samples: video.samples,
    });
    if let Some(a) = audio {
        let id = next(&tracks);
        tracks.push(Track {
            id,
            handler: b"soun",
            handler_name: "SoundHandler",
            timescale: a.rate,
            entry: mp4a(&a, id),
            media_header: full(b"smhd", 0, 0, &[0; 4]),
            flags: 3,
            volume: 0x100,
            size: (0, 0),
            edit: (a.skip as u64, ms(a.play, a.rate)),
            chapters: chapter_id,
            chunk: a.rate as u64,
            samples: a.frames.iter().map(|f| Sample { data: f, duration: 1024, sync: true }).collect(),
        });
    }
    if !chapters.is_empty() {
        let mut gmhd = bx(b"gmin", &[0, 0, 0, 0, 0, 0x40, 0x80, 0, 0x80, 0, 0x80, 0, 0, 0, 0, 0]);
        let mut text = Vec::new();
        text.bytes(&[0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]).bytes(&[0; 14]).bytes(&[0x40, 0, 0, 0]);
        gmhd.extend(bx(b"text", &text));
        let id = next(&tracks);
        let mut samples: Vec<Sample> = Vec::new();
        let mut at = 0;
        for (c, data) in chapters.iter().zip(&text_samples) {
            // Each title lasts until the next starts; a gap before the first is the first's too.
            let end = c.end_ms.max(at);
            if let Some(last) = samples.last_mut() {
                last.duration += c.start_ms.saturating_sub(at) as u32;
                at = at.max(c.start_ms);
            }
            samples.push(Sample { data, duration: (end - at) as u32, sync: true });
            at = end;
        }
        tracks.push(Track {
            id,
            handler: b"text",
            handler_name: "SubtitleHandler",
            timescale: MOVIE_SCALE,
            entry: text_entry(),
            media_header: bx(b"gmhd", &gmhd),
            flags: 2,
            volume: 0,
            size: (0, 0),
            edit: (0, at),
            chapters: None,
            chunk: 0,
            samples,
        });
    }
    let duration = tracks.iter().map(|t| t.edit.1).max().unwrap_or(0);

    // Chunks in the order they play, so a player reading the file front to back has every track's media for a
    // second together; the chapter titles first.
    let mut order: Vec<(f64, usize, usize)> = Vec::new();
    for (ti, t) in tracks.iter().enumerate() {
        let first = t.handler == b"text";
        for (ci, (_, _, start)) in t.chunks().into_iter().enumerate() {
            order.push((if first { -1.0 } else { start }, ti, ci));
        }
    }
    order.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
    let chunks: Vec<Vec<(usize, usize, f64)>> = tracks.iter().map(|t| t.chunks()).collect();
    let media: u64 = tracks.iter().flat_map(|t| &t.samples).map(|s| s.data.len() as u64).sum();

    let ftyp = {
        let mut b = Vec::new();
        b.bytes(b"isom").u32(0x200).bytes(b"isomiso2avc1mp41");
        bx(b"ftyp", &b)
    };
    let moov = |offsets: &[Vec<u64>], wide: bool| {
        let mut h = Vec::new();
        h.u32(0).u32(0).u32(MOVIE_SCALE).u32(duration as u32).u32(0x10000).u16(0x100).bytes(&[0; 10]);
        for m in MATRIX {
            h.u32(m);
        }
        h.bytes(&[0; 24]).u32(tracks.len() as u32 + 1);
        let mut b = full(b"mvhd", 0, 0, &h);
        for (t, o) in tracks.iter().zip(offsets) {
            b.extend(trak(t, o, wide));
        }
        if !chapters.is_empty() {
            b.extend(bx(b"udta", &chpl(chapters)));
        }
        bx(b"moov", &b)
    };
    let zero: Vec<Vec<u64>> = chunks.iter().map(|c| vec![0; c.len()]).collect();
    let narrow = moov(&zero, false).len() as u64;
    let wide = ftyp.len() as u64 + narrow + 16 + media > u32::MAX as u64;
    let head = ftyp.len() as u64 + moov(&zero, wide).len() as u64 + if wide { 16 } else { 8 };
    let mut offsets = zero;
    let mut at = head;
    for &(_, ti, ci) in &order {
        offsets[ti][ci] = at;
        let (first, n, _) = chunks[ti][ci];
        at += tracks[ti].samples[first..first + n].iter().map(|s| s.data.len() as u64).sum::<u64>();
    }
    out.write_all(&ftyp)?;
    out.write_all(&moov(&offsets, wide))?;
    if wide {
        out.write_all(&1u32.to_be_bytes())?;
        out.write_all(b"mdat")?;
        out.write_all(&(media + 16).to_be_bytes())?;
    } else {
        out.write_all(&(media as u32 + 8).to_be_bytes())?;
        out.write_all(b"mdat")?;
    }
    for &(_, ti, ci) in &order {
        let (first, n, _) = chunks[ti][ci];
        for s in &tracks[ti].samples[first..first + n] {
            out.write_all(s.data)?;
        }
    }
    Ok(())
}

/// A track read back from a file.
#[derive(Debug, Default)]
pub struct ReadTrack {
    pub handler: String,
    /// The sample description's type: avc1, mp4a or text.
    pub codec: String,
    pub timescale: u32,
    pub durations: Vec<u32>,
    /// 1-based sync samples; None when every sample is one.
    pub sync: Option<Vec<u32>>,
    /// Where each sample is in the file, and its size.
    pub samples: Vec<(u64, u32)>,
    /// The edit: media time and duration in the movie's timescale.
    pub edit: Option<(u64, u64)>,
    pub chapters: Option<u32>,
    pub id: u32,
    pub enabled: bool,
    /// The avcC or the esds's AudioSpecificConfig.
    pub config: Vec<u8>,
}

#[derive(Debug, Default)]
pub struct ReadFile {
    pub top: Vec<String>,
    pub duration_ms: u64,
    pub tracks: Vec<ReadTrack>,
    /// The Nero chapters: start in milliseconds and title.
    pub chpl: Vec<(u64, String)>,
}

/// A box read back: its type and body.
type Read<'a> = ([u8; 4], &'a [u8]);

/// The boxes in `b`.
fn boxes(mut b: &[u8]) -> Result<Vec<Read<'_>>, String> {
    let mut out = Vec::new();
    while b.len() >= 8 {
        let mut size = u32::from_be_bytes(b[0..4].try_into().unwrap()) as u64;
        let kind: [u8; 4] = b[4..8].try_into().unwrap();
        let mut head = 8;
        if size == 1 {
            size = u64::from_be_bytes(b.get(8..16).ok_or("truncated box")?.try_into().unwrap());
            head = 16;
        } else if size == 0 {
            size = b.len() as u64;
        }
        if size < head as u64 || size > b.len() as u64 {
            return Err(format!("bad size of box {}", String::from_utf8_lossy(&kind)));
        }
        out.push((kind, &b[head..size as usize]));
        b = &b[size as usize..];
    }
    Ok(out)
}

fn child<'a>(b: &'a [u8], kind: &[u8; 4]) -> Option<&'a [u8]> {
    boxes(b).ok()?.into_iter().find(|(k, _)| k == kind).map(|(_, b)| b)
}

fn be32(b: &[u8], at: usize) -> u32 {
    u32::from_be_bytes(b[at..at + 4].try_into().unwrap())
}

fn be64(b: &[u8], at: usize) -> u64 {
    u64::from_be_bytes(b[at..at + 8].try_into().unwrap())
}

/// Reads the structure of an MP4 this module wrote (and most others with 32-bit headers and one edit per track).
pub fn read(file: &[u8]) -> Result<ReadFile, String> {
    let top = boxes(file)?;
    let mut out =
        ReadFile { top: top.iter().map(|(k, _)| String::from_utf8_lossy(k).into()).collect(), ..Default::default() };
    let moov = top.iter().find(|(k, _)| k == b"moov").ok_or("no moov")?.1;
    for (kind, body) in boxes(moov)? {
        match &kind {
            b"mvhd" => {
                let scale = be32(body, 12) as u64;
                out.duration_ms = be32(body, 16) as u64 * 1000 / scale.max(1);
            }
            b"udta" => {
                if let Some(c) = child(body, b"chpl") {
                    let n = c[8] as usize;
                    let mut at = 9;
                    for _ in 0..n {
                        let start = be64(c, at) / 10_000;
                        let len = c[at + 8] as usize;
                        out.chpl.push((start, String::from_utf8_lossy(&c[at + 9..at + 9 + len]).into()));
                        at += 9 + len;
                    }
                }
            }
            b"trak" => out.tracks.push(read_trak(body)?),
            _ => {}
        }
    }
    Ok(out)
}

fn read_trak(trak: &[u8]) -> Result<ReadTrack, String> {
    let mut t = ReadTrack::default();
    let tkhd = child(trak, b"tkhd").ok_or("no tkhd")?;
    t.enabled = tkhd[3] & 1 == 1;
    t.id = be32(tkhd, 12);
    if let Some(e) = child(trak, b"edts").and_then(|e| child(e, b"elst")) {
        t.edit = Some((be32(e, 12) as u64, be32(e, 8) as u64));
    }
    t.chapters = child(trak, b"tref").and_then(|r| child(r, b"chap")).map(|c| be32(c, 0));
    let mdia = child(trak, b"mdia").ok_or("no mdia")?;
    t.timescale = be32(child(mdia, b"mdhd").ok_or("no mdhd")?, 12);
    t.handler = String::from_utf8_lossy(&child(mdia, b"hdlr").ok_or("no hdlr")?[8..12]).into();
    let stbl = child(child(mdia, b"minf").ok_or("no minf")?, b"stbl").ok_or("no stbl")?;
    let stsd = child(stbl, b"stsd").ok_or("no stsd")?;
    let (kind, entry) = *boxes(&stsd[8..])?.first().ok_or("empty stsd")?;
    t.codec = String::from_utf8_lossy(&kind).into();
    match &kind {
        b"avc1" => t.config = child(&entry[78..], b"avcC").unwrap_or_default().to_vec(),
        b"mp4a" => {
            let esds = child(&entry[28..], b"esds").ok_or("no esds")?;
            // The DecoderSpecificInfo: tag 5 and a one-byte length, as written above.
            if let Some(at) = esds.windows(2).position(|w| w[0] == 5 && w[1] < 16) {
                t.config = esds[at + 2..at + 2 + esds[at + 1] as usize].to_vec();
            }
        }
        _ => {}
    }
    let stts = child(stbl, b"stts").ok_or("no stts")?;
    for i in 0..be32(stts, 4) as usize {
        let (n, d) = (be32(stts, 8 + 8 * i), be32(stts, 12 + 8 * i));
        t.durations.extend(std::iter::repeat_n(d, n as usize));
    }
    t.sync = child(stbl, b"stss").map(|s| (0..be32(s, 4) as usize).map(|i| be32(s, 8 + 4 * i)).collect());
    let stsz = child(stbl, b"stsz").ok_or("no stsz")?;
    let sizes: Vec<u32> = (0..be32(stsz, 8) as usize)
        .map(|i| if be32(stsz, 4) != 0 { be32(stsz, 4) } else { be32(stsz, 12 + 4 * i) })
        .collect();
    let offsets: Vec<u64> = if let Some(c) = child(stbl, b"stco") {
        (0..be32(c, 4) as usize).map(|i| be32(c, 8 + 4 * i) as u64).collect()
    } else {
        let c = child(stbl, b"co64").ok_or("no stco")?;
        (0..be32(c, 4) as usize).map(|i| be64(c, 8 + 8 * i)).collect()
    };
    let stsc = child(stbl, b"stsc").ok_or("no stsc")?;
    let runs: Vec<(u32, u32)> =
        (0..be32(stsc, 4) as usize).map(|i| (be32(stsc, 8 + 12 * i), be32(stsc, 12 + 12 * i))).collect();
    let mut sample = 0usize;
    for (ci, &offset) in offsets.iter().enumerate() {
        let per = runs.iter().rev().find(|r| r.0 as usize <= ci + 1).ok_or("bad stsc")?.1;
        let mut at = offset;
        for _ in 0..per {
            let size = *sizes.get(sample).ok_or("stsc names more samples than stsz")?;
            t.samples.push((at, size));
            at += size as u64;
            sample += 1;
        }
    }
    if t.samples.len() != sizes.len() || t.durations.len() != sizes.len() {
        return Err(format!("{} track: the sample tables disagree", t.handler));
    }
    Ok(t)
}

/// The chapter titles of a text track and their start times in milliseconds.
pub fn text_chapters(file: &[u8], t: &ReadTrack) -> Vec<(u64, String)> {
    let mut at = 0u64;
    t.samples
        .iter()
        .zip(&t.durations)
        .map(|(&(offset, size), &d)| {
            let s = &file[offset as usize..(offset + size as u64) as usize];
            let len = u16::from_be_bytes([s[0], s[1]]) as usize;
            let start = at * 1000 / t.timescale as u64;
            at += d as u64;
            (start, String::from_utf8_lossy(&s[2..2 + len]).into())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chapters() -> Vec<Chapter> {
        vec![
            Chapter { start_ms: 0, end_ms: 1500, title: "Why this change".into() },
            Chapter { start_ms: 1500, end_ms: 4000, title: "Ünïcode, and a long one".into() },
        ]
    }

    #[test]
    fn sample_tables_and_chapters_read_back() {
        let frames: Vec<Vec<u8>> = (0..5u8).map(|i| vec![i; 10 + i as usize]).collect();
        let durations = [1, 3, 30, 1, 85];
        let video = Video {
            width: 1920,
            height: 1080,
            timescale: 30,
            sps: &[0x67, 100, 0, 40, 0xac],
            pps: &[0x68, 0xee],
            samples: frames
                .iter()
                .zip(durations)
                .enumerate()
                .map(|(i, (f, d))| Sample { data: f, duration: d, sync: i == 0 || i == 3 })
                .collect(),
        };
        let aus: Vec<Vec<u8>> = (0..200u8).map(|i| vec![i; 7]).collect();
        let audio = Audio {
            rate: 48_000,
            channels: 1,
            bitrate: 96_000,
            config: &[0x11, 0x88],
            frames: aus.iter().map(Vec::as_slice).collect(),
            skip: 2048,
            play: 4 * 48_000,
        };
        let mut file = Vec::new();
        write(&mut file, video, Some(audio), &chapters()).unwrap();
        let r = read(&file).unwrap();
        assert_eq!(r.top, ["ftyp", "moov", "mdat"], "the movie box comes before the media");
        assert_eq!(r.duration_ms, 4000);
        let [v, a, c] = &r.tracks[..] else { panic!("three tracks") };
        assert_eq!((v.codec.as_str(), v.timescale), ("avc1", 30));
        assert_eq!(v.durations, durations);
        assert_eq!(v.sync, Some(vec![1, 4]));
        assert_eq!(v.edit, Some((0, 4000)));
        assert_eq!(&v.config[..4], [1, 100, 0, 40]);
        for (i, &(offset, size)) in v.samples.iter().enumerate() {
            assert_eq!(&file[offset as usize..offset as usize + size as usize], frames[i].as_slice());
        }
        assert_eq!((a.codec.as_str(), a.timescale, a.durations.len()), ("mp4a", 48_000, 200));
        assert_eq!(a.config, [0x11, 0x88]);
        assert_eq!(a.edit, Some((2048, 4000)));
        assert!(a.sync.is_none());
        for (i, &(offset, size)) in a.samples.iter().enumerate() {
            assert_eq!(&file[offset as usize..offset as usize + size as usize], aus[i].as_slice());
        }
        assert_eq!((v.chapters, a.chapters), (Some(3), Some(3)));
        assert_eq!((c.handler.as_str(), c.codec.as_str(), c.enabled), ("text", "text", false));
        let want: Vec<(u64, String)> = chapters().into_iter().map(|c| (c.start_ms, c.title)).collect();
        assert_eq!(text_chapters(&file, c), want);
        assert_eq!(r.chpl, want);
        // The audio's chunks sit between the video's, a second at a time.
        let first_audio = a.samples[0].0;
        assert!(first_audio > v.samples[0].0 && first_audio < v.samples[4].0);
    }

    #[test]
    fn a_video_alone_has_no_extra_tracks() {
        let f = [0u8; 4];
        let video = Video {
            width: 64,
            height: 48,
            timescale: 30,
            sps: &[0x67, 77, 0, 30],
            pps: &[0x68],
            samples: vec![Sample { data: &f, duration: 2, sync: true }],
        };
        let mut file = Vec::new();
        write(&mut file, video, None, &[]).unwrap();
        let r = read(&file).unwrap();
        assert_eq!(r.tracks.len(), 1);
        assert_eq!(r.tracks[0].sync, None);
        assert_eq!(r.tracks[0].chapters, None);
        assert_eq!(r.duration_ms, 67);
        assert!(r.chpl.is_empty());
    }
}
