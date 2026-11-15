//! H.264 with OpenH264, built from source by openh264-sys2: one encoder per run of frames, each starting on an IDR
//! frame. Samples come out as MP4 wants them: NAL units with 4-byte lengths, without the parameter sets, which go
//! into the track's avcC once.

use openh264_sys2 as sys;
use std::os::raw::{c_int, c_void};
use std::ptr::null_mut;

/// What every encoder of a video is set to, so that their parameter sets are the same and their streams join.
#[derive(Clone, Copy, Debug)]
pub struct Settings {
    pub width: u32,
    pub height: u32,
    /// The quantizer of every frame (no rate control): lower is sharper and larger.
    pub qp: i32,
}

impl Settings {
    pub fn new(width: u32, height: u32) -> Settings {
        // QP 22 keeps text as sharp as x264 at CRF 18 did, a little larger in the stills' differences and a
        // little smaller in bytes (docs/adr/0044-encode-in-the-engine.md has the measurements).
        Settings { width, height, qp: 22 }
    }
}

/// One encoded frame.
pub struct Sample {
    /// NAL units, each after its length as 4 bytes big-endian, without SPS and PPS.
    pub data: Vec<u8>,
    /// An IDR frame: decoding can start here.
    pub sync: bool,
}

pub struct Encoder {
    enc: *mut sys::ISVCEncoder,
    vtbl: sys::ISVCEncoderVtbl,
    settings: Settings,
    info: Box<sys::SFrameBSInfo>,
    /// The SPS and PPS of the first IDR frame.
    pub sps: Vec<u8>,
    pub pps: Vec<u8>,
}

// The encoder is only ever used by one thread at a time, which owns it.
unsafe impl Send for Encoder {}

fn check(what: &str, rv: c_int) -> Result<(), String> {
    if rv == 0 { Ok(()) } else { Err(format!("H.264 encoder: {what} failed ({rv})")) }
}

impl Encoder {
    pub fn new(s: Settings) -> Result<Encoder, String> {
        let mut enc: *mut sys::ISVCEncoder = null_mut();
        // SAFETY: WelsCreateSVCEncoder writes a valid encoder (whose first field is its vtable) or fails.
        let vtbl = unsafe {
            check("creating", sys::source::APILoader::WelsCreateSVCEncoder(&mut enc))?;
            if enc.is_null() {
                return Err("H.264 encoder: creating failed".into());
            }
            **enc
        };
        let e = Encoder { enc, vtbl, settings: s, info: Box::default(), sps: Vec::new(), pps: Vec::new() };
        let mut p = sys::SEncParamExt::default();
        // SAFETY: the vtable's functions take the encoder and pointers to live values.
        unsafe {
            check("reading defaults", (e.vtbl.GetDefaultParams.unwrap())(e.enc, &mut p))?;
        }
        // The screen content mode is three times slower here and no smaller.
        p.iUsageType = sys::CAMERA_VIDEO_REAL_TIME;
        p.iPicWidth = s.width as c_int;
        p.iPicHeight = s.height as c_int;
        p.iRCMode = sys::RC_OFF_MODE;
        p.fMaxFrameRate = 30.0;
        p.iTemporalLayerNum = 1;
        p.iSpatialLayerNum = 1;
        // Medium and high effort save about 4% for 10-30% more time.
        p.iComplexityMode = sys::LOW_COMPLEXITY;
        // One IDR frame at the start; the encoder may add more where the picture changes completely.
        p.uiIntraPeriod = 0;
        p.iNumRefFrame = 1;
        p.eSpsPpsIdStrategy = sys::CONSTANT_ID;
        p.bPrefixNalAddingCtrl = false;
        p.bEnableSSEI = false;
        // CABAC: 10% smaller than CAVLC at about the same speed.
        p.iEntropyCodingModeFlag = 1;
        p.bEnableFrameSkip = false;
        p.iMaxQp = s.qp;
        p.iMinQp = s.qp;
        p.iMultipleThreadIdc = 1;
        p.iLoopFilterDisableIdc = 0;
        p.bEnableDenoise = false;
        p.bEnableBackgroundDetection = false;
        p.bEnableAdaptiveQuant = false;
        p.bEnableFrameCroppingFlag = true;
        p.bEnableSceneChangeDetect = true;
        p.bEnableLongTermReference = false;
        let l = &mut p.sSpatialLayers[0];
        l.iVideoWidth = s.width as c_int;
        l.iVideoHeight = s.height as c_int;
        l.fFrameRate = 30.0;
        l.uiProfileIdc = sys::PRO_HIGH;
        l.uiLevelIdc = sys::LEVEL_4_0;
        l.iDLayerQp = s.qp;
        l.sSliceArgument.uiSliceMode = sys::SM_SINGLE_SLICE;
        l.sSliceArgument.uiSliceNum = 1;
        // The frames are BT.601 limited range (encode::yuv420); sRGB primaries and transfer.
        l.bVideoSignalTypePresent = true;
        l.uiVideoFormat = 5;
        l.bFullRange = false;
        l.bColorDescriptionPresent = true;
        l.uiColorPrimaries = 1;
        l.uiTransferCharacteristics = 13;
        l.uiColorMatrix = 6;
        // SAFETY: as above; the options point at live values of the types the encoder expects.
        unsafe {
            let mut quiet: c_int = sys::WELS_LOG_QUIET as c_int;
            check(
                "setting the log level",
                (e.vtbl.SetOption.unwrap())(e.enc, sys::ENCODER_OPTION_TRACE_LEVEL, (&raw mut quiet).cast::<c_void>()),
            )?;
            check("initializing", (e.vtbl.InitializeExt.unwrap())(e.enc, &p))?;
            let mut format: c_int = sys::videoFormatI420 as c_int;
            check(
                "setting the format",
                (e.vtbl.SetOption.unwrap())(e.enc, sys::ENCODER_OPTION_DATAFORMAT, (&raw mut format).cast::<c_void>()),
            )?;
        }
        Ok(e)
    }

    /// Encodes one yuv420p frame (as encode::yuv420 lays it out) at `ms` milliseconds.
    pub fn encode(&mut self, yuv: &[u8], ms: i64) -> Result<Sample, String> {
        let (w, h) = (self.settings.width as usize, self.settings.height as usize);
        let (cw, ch) = (w.div_ceil(2), h.div_ceil(2));
        assert_eq!(yuv.len(), w * h + 2 * cw * ch);
        let base = yuv.as_ptr().cast_mut();
        let pic = sys::SSourcePicture {
            iColorFormat: sys::videoFormatI420 as c_int,
            iStride: [w as c_int, cw as c_int, cw as c_int, 0],
            // SAFETY: the offsets are inside `yuv`, and the encoder only reads the planes.
            pData: unsafe { [base, base.add(w * h), base.add(w * h + cw * ch), null_mut()] },
            iPicWidth: w as c_int,
            iPicHeight: h as c_int,
            uiTimeStamp: ms,
            bPsnrY: false,
            bPsnrU: false,
            bPsnrV: false,
        };
        // SAFETY: `pic` points into `yuv`, which outlives the call; `info` is ours.
        unsafe { check("encoding a frame", (self.vtbl.EncodeFrame.unwrap())(self.enc, &pic, &mut *self.info))? };
        let info = &*self.info;
        if info.eFrameType == sys::videoFrameTypeSkip || info.eFrameType == sys::videoFrameTypeInvalid {
            return Err(format!("H.264 encoder: a frame was not encoded (type {})", info.eFrameType));
        }
        let mut out = Sample { data: Vec::new(), sync: info.eFrameType == sys::videoFrameTypeIDR };
        for layer in &info.sLayerInfo[..info.iLayerNum as usize] {
            let mut at = 0usize;
            for i in 0..layer.iNalCount as usize {
                // SAFETY: the encoder's layer holds iNalCount lengths and that many bytes after pBsBuf.
                let nal = unsafe {
                    let len = *layer.pNalLengthInByte.add(i) as usize;
                    let nal = std::slice::from_raw_parts(layer.pBsBuf.add(at), len);
                    at += len;
                    nal
                };
                let nal = strip_start_code(nal);
                match nal.first().map(|b| b & 0x1f) {
                    None => {}
                    Some(7) => keep_first(&mut self.sps, nal)?,
                    Some(8) => keep_first(&mut self.pps, nal)?,
                    Some(_) => {
                        out.data.extend((nal.len() as u32).to_be_bytes());
                        out.data.extend_from_slice(nal);
                    }
                }
            }
        }
        Ok(out)
    }
}

/// Keeps the first parameter set of a kind; later ones must be the same, since the track carries only one.
fn keep_first(slot: &mut Vec<u8>, nal: &[u8]) -> Result<(), String> {
    if slot.is_empty() {
        slot.extend_from_slice(nal);
    } else if slot.as_slice() != nal {
        return Err("H.264 encoder: the parameter sets changed mid-stream".into());
    }
    Ok(())
}

fn strip_start_code(nal: &[u8]) -> &[u8] {
    if nal.starts_with(&[0, 0, 0, 1]) {
        &nal[4..]
    } else if nal.starts_with(&[0, 0, 1]) {
        &nal[3..]
    } else {
        nal
    }
}

impl Drop for Encoder {
    fn drop(&mut self) {
        // SAFETY: the encoder was created and initialized in `new` and is not used after this.
        unsafe {
            (self.vtbl.Uninitialize.unwrap())(self.enc);
            sys::source::APILoader::WelsDestroySVCEncoder(self.enc);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encoders_share_parameter_sets_and_start_on_idr_frames() {
        let s = Settings::new(64, 48);
        let mut frame = vec![128u8; 64 * 48 * 3 / 2];
        let mut a = Encoder::new(s).unwrap();
        let mut b = Encoder::new(s).unwrap();
        let first = a.encode(&frame, 0).unwrap();
        assert!(first.sync);
        frame[100] = 30;
        let second = a.encode(&frame, 33).unwrap();
        assert!(!second.sync);
        assert!(b.encode(&frame, 0).unwrap().sync);
        assert_eq!(a.sps, b.sps);
        assert_eq!(a.pps, b.pps);
        assert_eq!(a.sps[1], 100, "High profile");
        // Every NAL unit is a length and its bytes.
        let mut at = 0;
        while at < second.data.len() {
            at += 4 + u32::from_be_bytes(second.data[at..at + 4].try_into().unwrap()) as usize;
        }
        assert_eq!(at, second.data.len());
    }
}
