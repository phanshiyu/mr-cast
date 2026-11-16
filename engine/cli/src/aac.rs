//! AAC-LC with the Fraunhofer FDK AAC library, built from source by fdk-aac-sys: the voice-over as raw access units
//! for the MP4, and (for checks) back to samples.

use fdk_aac_sys as sys;
use std::os::raw::{c_int, c_void};
use std::ptr::null_mut;

/// The voice-over, encoded.
pub struct Encoded {
    pub rate: u32,
    /// The AudioSpecificConfig the track's esds carries.
    pub config: Vec<u8>,
    /// Access units of 1024 samples each.
    pub frames: Vec<Vec<u8>>,
    /// Samples the encoder put before the first input sample; the track's edit list skips them.
    pub delay: u32,
    /// The input's length in samples, which the edit list plays.
    pub samples: u64,
}

fn check(what: &str, rv: u32) -> Result<(), String> {
    if rv == sys::AACENC_ERROR_AACENC_OK { Ok(()) } else { Err(format!("AAC encoder: {what} failed ({rv:#x})")) }
}

struct Handle(sys::HANDLE_AACENCODER);

impl Drop for Handle {
    fn drop(&mut self) {
        // SAFETY: the handle came from aacEncOpen and is closed once.
        unsafe { sys::aacEncClose(&mut self.0) };
    }
}

/// Encodes mono 16-bit samples at `rate` as AAC-LC at `bitrate` bits a second.
pub fn encode(samples: &[i16], rate: u32, bitrate: u32) -> Result<Encoded, String> {
    let mut h = Handle(null_mut());
    // SAFETY: plain calls on the handle aacEncOpen made; the buffers handed over live through each call.
    unsafe {
        check("opening", sys::aacEncOpen(&mut h.0, 0, 1))?;
        for (what, param, value) in [
            ("the object type", sys::AACENC_PARAM_AACENC_AOT, sys::AUDIO_OBJECT_TYPE_AOT_AAC_LC as u32),
            ("the sample rate", sys::AACENC_PARAM_AACENC_SAMPLERATE, rate),
            ("the channel mode", sys::AACENC_PARAM_AACENC_CHANNELMODE, 1),
            ("the bit rate", sys::AACENC_PARAM_AACENC_BITRATE, bitrate),
            ("the transport", sys::AACENC_PARAM_AACENC_TRANSMUX, sys::TRANSPORT_TYPE_TT_MP4_RAW as u32),
            ("the afterburner", sys::AACENC_PARAM_AACENC_AFTERBURNER, 1),
        ] {
            check(&format!("setting {what}"), sys::aacEncoder_SetParam(h.0, param, value))?;
        }
        check("initializing", sys::aacEncEncode(h.0, null_mut(), null_mut(), null_mut(), null_mut()))?;
        let mut info: sys::AACENC_InfoStruct = std::mem::zeroed();
        check("reading its setup", sys::aacEncInfo(h.0, &mut info))?;
        let mut out = Encoded {
            rate,
            config: info.confBuf[..info.confSize as usize].to_vec(),
            frames: Vec::new(),
            delay: info.nDelay,
            samples: samples.len() as u64,
        };
        let mut buf = vec![0u8; (info.maxOutBufBytes as usize).max(8192)];
        let mut at = 0usize;
        loop {
            let rest = &samples[at..];
            let mut in_ptr = rest.as_ptr().cast_mut().cast::<c_void>();
            let mut in_id: c_int = sys::AACENC_BufferIdentifier_IN_AUDIO_DATA as c_int;
            let mut in_size: c_int = (rest.len() * 2) as c_int;
            let mut in_el: c_int = 2;
            let in_desc = sys::AACENC_BufDesc {
                numBufs: 1,
                bufs: &mut in_ptr,
                bufferIdentifiers: &mut in_id,
                bufSizes: &mut in_size,
                bufElSizes: &mut in_el,
            };
            let mut out_ptr = buf.as_mut_ptr().cast::<c_void>();
            let mut out_id: c_int = sys::AACENC_BufferIdentifier_OUT_BITSTREAM_DATA as c_int;
            let mut out_size: c_int = buf.len() as c_int;
            let mut out_el: c_int = 1;
            let out_desc = sys::AACENC_BufDesc {
                numBufs: 1,
                bufs: &mut out_ptr,
                bufferIdentifiers: &mut out_id,
                bufSizes: &mut out_size,
                bufElSizes: &mut out_el,
            };
            // -1 samples flushes what the encoder holds.
            let in_args = sys::AACENC_InArgs {
                numInSamples: if rest.is_empty() { -1 } else { rest.len() as c_int },
                numAncBytes: 0,
            };
            let mut out_args: sys::AACENC_OutArgs = std::mem::zeroed();
            let rv = sys::aacEncEncode(h.0, &in_desc, &out_desc, &in_args, &mut out_args);
            if rv == sys::AACENC_ERROR_AACENC_ENCODE_EOF {
                break;
            }
            check("encoding", rv)?;
            at += out_args.numInSamples as usize;
            if out_args.numOutBytes > 0 {
                out.frames.push(buf[..out_args.numOutBytes as usize].to_vec());
            }
        }
        Ok(out)
    }
}

/// Samples the FDK decoder outputs before the stream's own first sample.
pub const DECODER_DELAY: usize = 1024;

/// Decodes raw AAC access units back to 16-bit samples, every channel interleaved: for checking the MP4.
pub fn decode(config: &[u8], frames: &[&[u8]]) -> Result<(u32, u32, Vec<i16>), String> {
    // SAFETY: the decoder handle lives until the close below; every buffer handed over outlives its call.
    unsafe {
        let h = sys::aacDecoder_Open(sys::TRANSPORT_TYPE_TT_MP4_RAW, 1);
        if h.is_null() {
            return Err("AAC decoder: opening failed".into());
        }
        let result = (|| {
            // The limiter would delay the output by its look-ahead.
            sys::aacDecoder_SetParam(h, sys::AACDEC_PARAM_AAC_PCM_LIMITER_ENABLE, 0);
            let mut conf = config.as_ptr().cast_mut();
            let len = config.len() as u32;
            if sys::aacDecoder_ConfigRaw(h, &mut conf, &len) != sys::AAC_DECODER_ERROR_AAC_DEC_OK {
                return Err("AAC decoder: bad AudioSpecificConfig".to_string());
            }
            let mut pcm = Vec::new();
            let mut frame = vec![0i16; 8 * 2048];
            for f in frames {
                let mut ptr = f.as_ptr().cast_mut();
                let size = f.len() as u32;
                let mut valid = size;
                if sys::aacDecoder_Fill(h, &mut ptr, &size, &mut valid) != sys::AAC_DECODER_ERROR_AAC_DEC_OK {
                    return Err("AAC decoder: filling failed".to_string());
                }
                let rv = sys::aacDecoder_DecodeFrame(h, frame.as_mut_ptr(), frame.len() as c_int, 0);
                if rv != sys::AAC_DECODER_ERROR_AAC_DEC_OK {
                    return Err(format!("AAC decoder: decoding failed ({rv:#x})"));
                }
                let info = &*sys::aacDecoder_GetStreamInfo(h);
                pcm.extend_from_slice(&frame[..(info.frameSize * info.numChannels) as usize]);
            }
            let info = &*sys::aacDecoder_GetStreamInfo(h);
            Ok((info.sampleRate as u32, info.numChannels as u32, pcm))
        })();
        sys::aacDecoder_Close(h);
        result
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_tone_survives_encoding_at_its_place() {
        let rate = 48_000;
        // Half a second of silence, then a 440 Hz tone for half a second.
        let samples: Vec<i16> = (0..rate)
            .map(|i| {
                if i < rate / 2 {
                    0
                } else {
                    (12000.0 * (i as f64 * 440.0 * std::f64::consts::TAU / rate as f64).sin()) as i16
                }
            })
            .collect();
        let enc = super::encode(&samples, rate as u32, 96_000).unwrap();
        assert_eq!(enc.config, [0x11, 0x88], "AAC-LC, 48 kHz, mono");
        assert!(enc.frames.len() * 1024 >= samples.len() + enc.delay as usize);
        let frames: Vec<&[u8]> = enc.frames.iter().map(Vec::as_slice).collect();
        let (r, ch, pcm) = super::decode(&enc.config, &frames).unwrap();
        assert_eq!((r, ch), (48_000, 1));
        let pcm = &pcm[enc.delay as usize + super::DECODER_DELAY..];
        let onset = pcm.iter().position(|s| s.abs() > 2000).unwrap();
        assert!((onset as i64 - rate as i64 / 2).abs() < 48, "onset at {onset}, delay {}", enc.delay);
    }
}
