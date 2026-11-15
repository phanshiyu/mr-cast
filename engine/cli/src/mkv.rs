//! A minimal Matroska stream of raw I420 frames with their own timestamps, for ffmpeg to read from a pipe. A
//! frame that repeats the one before is left out and the one before simply lasts longer, so the encoder only
//! sees frames that change: most of a walkthrough's frames repeat.

/// An EBML variable-length size.
fn size(n: u64) -> Vec<u8> {
    let mut len = 1;
    while len < 8 && n >= (1u64 << (7 * len)) - 1 {
        len += 1;
    }
    let v = n | (1u64 << (7 * len));
    v.to_be_bytes()[8 - len..].to_vec()
}

fn id(id: u32) -> Vec<u8> {
    let b = id.to_be_bytes();
    let skip = b.iter().take_while(|&&x| x == 0).count();
    b[skip..].to_vec()
}

fn element(i: u32, body: &[u8]) -> Vec<u8> {
    let mut out = id(i);
    out.extend(size(body.len() as u64));
    out.extend_from_slice(body);
    out
}

fn uint(i: u32, v: u64) -> Vec<u8> {
    let b = v.to_be_bytes();
    let skip = b.iter().take_while(|&&x| x == 0).count().min(7);
    element(i, &b[skip..])
}

/// Nanoseconds per timestamp tick: one tick is one frame at 30 fps.
const TICK_NS: u64 = 33_333_333;

/// The stream's header: EBML header, an open-ended segment, its info and its one raw video track.
pub fn header(w: u32, h: u32) -> Vec<u8> {
    let mut ebml = Vec::new();
    for (i, v) in [(0x4286, 1), (0x42F7, 1), (0x42F2, 4), (0x42F3, 8)] {
        ebml.extend(uint(i, v));
    }
    ebml.extend(element(0x4282, b"matroska"));
    ebml.extend(uint(0x4287, 4));
    ebml.extend(uint(0x4285, 2));
    let mut out = element(0x1A45DFA3, &ebml);
    out.extend(id(0x18538067));
    out.extend([0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
    let mut info = uint(0x2AD7B1, TICK_NS);
    info.extend(element(0x4D80, b"mr-cast-engine"));
    info.extend(element(0x5741, b"mr-cast-engine"));
    out.extend(element(0x1549A966, &info));
    let mut video = uint(0xB0, w as u64);
    video.extend(uint(0xBA, h as u64));
    video.extend(element(0x2EB524, b"I420"));
    let mut track = uint(0xD7, 1);
    track.extend(uint(0x73C5, 1));
    track.extend(uint(0x83, 1));
    track.extend(uint(0x9C, 0));
    track.extend(uint(0x23E383, TICK_NS));
    track.extend(element(0x86, b"V_UNCOMPRESSED"));
    track.extend(element(0xE0, &video));
    out.extend(element(0x1654AE6B, &element(0xAE, &track)));
    out
}

/// The head of a cluster holding one frame at `frame` (in frame ticks) of `len` bytes; the frame's bytes follow.
pub fn frame_head(frame: u64, len: usize) -> Vec<u8> {
    let block_body = 4 + len;
    let mut block = id(0xA3);
    block.extend(size(block_body as u64));
    block.extend([0x81, 0x00, 0x00, 0x80]);
    let ts = uint(0xE7, frame);
    let mut out = id(0x1F43B675);
    out.extend(size((ts.len() + block.len() + len) as u64));
    out.extend(ts);
    out.extend(block);
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn sizes_are_ebml_varints() {
        assert_eq!(super::size(1), vec![0x81]);
        assert_eq!(super::size(127), vec![0x40, 0x7F]);
        assert_eq!(super::size(3_110_400), vec![0x10, 0x2F, 0x76, 0x00]);
    }
}
