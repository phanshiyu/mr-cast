# 44. The engine encodes the MP4 itself, with no ffmpeg

- Status: Accepted
- Date: 2026-11-16
- Supersedes: the ffmpeg part of [ADR 43](0043-engine-ships-in-the-package.md)

## Context

[ADR 43](0043-engine-ships-in-the-package.md) had the engine pipe its frames to an ffmpeg found through
`MR_CAST_FFMPEG`, the `ffmpeg-static` package or the PATH. `ffmpeg-static` downloads its binary in an install script.
npm 12 runs no dependency install scripts unless the user allows them, so most installs would have no ffmpeg from it,
and many Macs have none on the PATH. Asking users to install ffmpeg undoes the point of shipping the engine in the
package: one install, then render.

## Decision

One encoder, inside the engine binary:

- **Video:** OpenH264, compiled from source by the `openh264-sys2` crate with the C++ compiler the build already has.
  High profile with CABAC, yuv420p, a fixed quantizer (QP 22) and no rate control. The frames that change are split
  into one run per core (at least about ten seconds of changing frames each); every run has its own encoder and
  starts on an IDR frame, and the runs' samples are joined in order. All encoders share one setting, so their SPS and
  PPS are the same and go into the track's `avcC` once.
- **Audio:** the voice clips are mixed at 48 kHz, and the Fraunhofer FDK AAC encoder (the `fdk-aac-sys` crate, also
  compiled from source) encodes them as mono AAC-LC at 96 kbit/s, on its own thread while the frames render.
- **MP4:** written by the engine (`engine/cli/src/mp4.rs`): the movie box before the media, chunks of about a second
  of each track interleaved, per-sample durations (a frame that repeats the one before only makes the sample before
  it longer, as before), sync samples, an edit list that skips the AAC encoder's 2048 samples of priming, and chapters
  both as a QuickTime text track named by `chap` (QuickTime, Safari) and as a Nero `chpl` box (VLC, ffprobe), as ffmpeg
  wrote them. The colours are tagged (BT.709 primaries, sRGB transfer, BT.601 matrix, limited range), which they were
  not before.
- `ffmpeg-static`, `MR_CAST_FFMPEG` and every ffmpeg lookup are removed. Keeping ffmpeg as an option would keep two
  encoders to test and two kinds of files to support.
- OpenH264's x86 assembly needs nasm, which the CI runners lack, so the published binaries are built without it
  (`OPENH264_NO_ASM`); ARM builds keep their NEON code.

## Measurements

Apple M1, 8 cores, with other agents loading the machine (load average 11 to 28), so the times are from runs taken
back to back. The silent demo-simple example: 13,380 frames (7.4 minutes), 3,120 of them changing.

| | wall | user CPU | size |
| --- | --- | --- | --- |
| engine, OpenH264 QP 22 | 10.5 to 10.8 s | 64 to 65 s | 10.6 MB |
| engine piping to ffmpeg, x264 veryfast CRF 18 | 13.1 to 18.7 s | 81 to 85 s, and about 10 s of system time | 13.7 MB |
| engine drawing only, no encoding | 7.8 to 15.1 s | 45 to 47 s | |

On an idle machine the x264 render took 7.9 s; encoding now costs about 19 s of CPU where x264 and the pipe cost
about 45, so the same render should take less.
One OpenH264 encoder does about 230 changing frames a second on one M1 core; its screen content mode was three times
slower and no smaller, and medium effort saved 4% for 12% more time. Built for x86-64 without assembly and run under
Rosetta, it does about 115.

Stills of six scenes taken from the MP4 differ from the engine's PNGs by a mean of 0.44 to 0.87 levels of 255 (worst
64-pixel tile 2.8 to 5.0), against 0.34 to 0.61 (2.2 to 4.0) for x264; turning the PNG into yuv420p and back alone
costs 0.36. Side by side at four times the size, text and code look the same. QP 20 would be 12.4 MB and only 0.03
levels closer. The voiced demo (7.2 minutes) is 15.9 MB, 5.2 MB of it the voice.

Checked: ffmpeg decodes every frame without an error, and ffprobe reads the chapters; AVFoundation (what QuickTime and
Safari use) opens the file, plays every track and lists the chapters; Chrome plays the video and the voice. ffmpeg's
decoder puts the voice clips' onsets within 3 samples of their frames. Firefox, VLC and GitHub's upload were not
tried.

## Licences

- OpenH264 is BSD 2-Clause: the copyright notice goes with the binary, in `THIRD-PARTY-NOTICES.md`.
- FDK AAC is under Fraunhofer's own licence. It allows redistribution in binary form without fees, provided the
  licence text goes with the binary (`THIRD-PARTY-NOTICES.md`, in the package), the complete source of the codec is
  available free of charge (it is, in the `fdk-aac-sys` crate on crates.io), and Fraunhofer's name is not used to
  promote mr-cast. It is not an OSI licence and is not GPL-compatible; mr-cast is MIT and links nothing GPL, so that
  does not matter here, but a distribution that only takes OSI licences would need to rebuild without it.
- Neither licence grants patent rights. H.264 and AAC are patented formats. Cisco pays the H.264 pool's fees only for
  its own prebuilt OpenH264 binary, downloaded at install time, which is the install-time download this decision
  removes; mr-cast builds OpenH264 from source instead. ffmpeg-static's x264 was in the same position before this.
  mr-cast has not taken legal advice on either format.

## Consequences

- `npm i -g @shiyuphan/mr-cast` renders with nothing else installed and no install script.
- The engine build compiles about 300 C and C++ files; a clean `cargo build --release` takes longer, and every
  platform's runner needs a C++ compiler (each has one).
- The tests read MP4s back with `mr-cast-engine probe`, which parses the file and decodes the voice with FDK's
  decoder, so neither the tests nor the smoke check need ffmpeg.
- x86 binaries encode more slowly than they would with assembly.

## Alternatives considered

- **Keep ffmpeg, from the PATH or a download at first render:** a second install step, or a large download at
  render time, and a GPL x264 to ship or fetch.
- **The platform's encoder** (VideoToolbox, Media Foundation): no Linux, and a different file per platform.
- **Cisco's prebuilt OpenH264:** it must be downloaded at install time, which npm 12 blocks, and it is a separate
  library per platform.
- **Pure-Rust encoders:** the H.264 and AAC ones on crates.io are young; the AAC ports carry the same FDK licence.
- **libxaac (Apache 2.0) for AAC:** a cleaner licence, but its Rust bindings are young; it can replace FDK AAC later
  without changing the file format.
