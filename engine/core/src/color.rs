//! CSS colours as the TSX writes them: `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, `hsl()`, `transparent`.

/// A straight (not premultiplied) sRGB colour, 0 to 1 per channel.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Color {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

impl Color {
    pub const TRANSPARENT: Color = Color { r: 0.0, g: 0.0, b: 0.0, a: 0.0 };

    pub const fn rgba8(r: u8, g: u8, b: u8, a: f32) -> Color {
        Color { r: r as f32 / 255.0, g: g as f32 / 255.0, b: b as f32 / 255.0, a }
    }

    /// Parses a CSS colour; unknown text is transparent, so a typo shows as a gap rather than a crash.
    pub fn css(s: &str) -> Color {
        parse(s.trim()).unwrap_or(Color::TRANSPARENT)
    }

    /// This colour with its alpha multiplied by `k`.
    pub fn fade(self, k: f32) -> Color {
        Color { a: self.a * k, ..self }
    }

    /// This colour at alpha `a`.
    pub fn alpha(self, a: f32) -> Color {
        Color { a, ..self }
    }

    pub fn to_skia(self) -> tiny_skia::Color {
        tiny_skia::Color::from_rgba(
            self.r.clamp(0.0, 1.0),
            self.g.clamp(0.0, 1.0),
            self.b.clamp(0.0, 1.0),
            self.a.clamp(0.0, 1.0),
        )
        .unwrap_or(tiny_skia::Color::TRANSPARENT)
    }
}

fn hex(s: &str) -> Option<Color> {
    let d: Vec<u8> = s.chars().map(|c| c.to_digit(16).map(|v| v as u8)).collect::<Option<_>>()?;
    let (r, g, b, a) = match d.len() {
        3 => (d[0] * 17, d[1] * 17, d[2] * 17, 255),
        4 => (d[0] * 17, d[1] * 17, d[2] * 17, d[3] * 17),
        6 => (d[0] * 16 + d[1], d[2] * 16 + d[3], d[4] * 16 + d[5], 255),
        8 => (d[0] * 16 + d[1], d[2] * 16 + d[3], d[4] * 16 + d[5], d[6] * 16 + d[7]),
        _ => return None,
    };
    Some(Color::rgba8(r, g, b, a as f32 / 255.0))
}

fn args(s: &str) -> Vec<f32> {
    s.split(|c: char| c == ',' || c == '/' || c.is_whitespace())
        .filter(|p| !p.is_empty())
        .map(|p| {
            let p = p.trim_end_matches(['%', 'g']).trim_end_matches("de");
            p.parse::<f32>().unwrap_or(0.0)
        })
        .collect()
}

fn hsl_to_rgb(h: f32, s: f32, l: f32) -> (f32, f32, f32) {
    let h = ((h % 360.0) + 360.0) % 360.0 / 360.0;
    let f = |n: f32| {
        let k = (n + h * 12.0) % 12.0;
        let a = s * l.min(1.0 - l);
        l - a * (-1.0f32).max((k - 3.0).min(9.0 - k).min(1.0))
    };
    (f(0.0), f(8.0), f(4.0))
}

fn parse(s: &str) -> Option<Color> {
    if s == "transparent" {
        return Some(Color::TRANSPARENT);
    }
    if let Some(h) = s.strip_prefix('#') {
        return hex(h);
    }
    let open = s.find('(')?;
    let name = &s[..open];
    let a = args(s[open + 1..].trim_end_matches(')'));
    let alpha = a.get(3).copied().unwrap_or(1.0);
    match name {
        "rgb" | "rgba" => Some(Color { r: a[0] / 255.0, g: a[1] / 255.0, b: a[2] / 255.0, a: alpha }),
        "hsl" | "hsla" => {
            let (r, g, b) = hsl_to_rgb(a[0], a[1] / 100.0, a[2] / 100.0);
            Some(Color { r, g, b, a: alpha })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::Color;

    #[test]
    fn parses_css() {
        assert_eq!(Color::css("#7c8cff"), Color::rgba8(0x7c, 0x8c, 0xff, 1.0));
        assert_eq!(Color::css("rgba(255, 255, 255, 0.08)"), Color { r: 1.0, g: 1.0, b: 1.0, a: 0.08 });
        let c = Color::css("hsl(220, 14%, 71%)");
        assert!((c.r * 255.0 - 171.0).abs() < 1.0 && (c.b * 255.0 - 191.0).abs() < 1.0);
    }
}

/// A colour with its alpha written as two hex digits, as `${color}aa` in the TSX.
pub fn hex_alpha(c: Color, a: u32) -> Color {
    c.alpha(a.min(255) as f32 / 255.0)
}
