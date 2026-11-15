//! The `sequence`, `timeline` and `layers` entries of TARGETS in shared/targets.mjs.

use crate::timing::index_range;
use serde_json::Value;

fn list<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key).and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

fn str_of<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

fn is_index(r: &Value, count: usize) -> Option<usize> {
    r.as_u64().filter(|&n| (n as usize) < count).map(|n| n as usize)
}

fn range_keys(prefix: &str, r: (usize, usize)) -> Vec<String> {
    (r.0..=r.1).map(|i| format!("{prefix}{i}")).collect()
}

/// The layer ("l:id") or item ("i:id") a layers scene names by id, or by "layer.item".
fn layer_part(scene: &Value, r: &str) -> Option<Vec<String>> {
    let layers = list(scene, "layers");
    if layers.iter().any(|l| str_of(l, "id") == Some(r)) {
        return Some(vec![format!("l:{r}")]);
    }
    let has_item = |id: &str| layers.iter().any(|l| list(l, "items").iter().any(|it| str_of(it, "id") == Some(id)));
    if has_item(r) {
        return Some(vec![format!("i:{r}")]);
    }
    for (at, _) in r.match_indices('.') {
        if at == 0 {
            continue;
        }
        let layer = layers.iter().find(|l| str_of(l, "id") == Some(&r[..at]));
        let item = layer.and_then(|l| list(l, "items").iter().find(|it| str_of(it, "id") == Some(&r[at + 1..])));
        if let Some(item) = item {
            return Some(vec![format!("i:{}", str_of(item, "id").unwrap_or_default())]);
        }
    }
    None
}

/// The item keys a ref names in a sequence, timeline or layers scene.
pub fn resolve(scene: &Value, r: &Value) -> Option<Vec<String>> {
    match str_of(scene, "type")? {
        "sequence" => {
            if let Some(id) =
                r.as_str().filter(|id| list(scene, "participants").iter().any(|p| str_of(p, "id") == Some(id)))
            {
                return Some(vec![format!("p:{id}")]);
            }
            let range = index_range(r)?;
            (range.1 < list(scene, "messages").len()).then(|| range_keys("m:", range))
        }
        "timeline" => {
            if let Some(label) = r.as_str().and_then(|s| s.strip_prefix("span:")) {
                let label = label.trim();
                let hits: Vec<String> = list(scene, "spans")
                    .iter()
                    .enumerate()
                    .filter(|(_, s)| str_of(s, "label") == Some(label))
                    .map(|(i, _)| format!("sp:{i}"))
                    .collect();
                return (!hits.is_empty()).then_some(hits);
            }
            let range = index_range(r)?;
            (range.1 < list(scene, "events").len()).then(|| range_keys("ev:", range))
        }
        "layers" => {
            let stops = scene.get("path").map_or(&[][..], |p| list(p, "stops"));
            if let Some(i) = is_index(r, stops.len()) {
                return stops[i].as_str().and_then(|s| layer_part(scene, s));
            }
            r.as_str().and_then(|s| layer_part(scene, s))
        }
        _ => None,
    }
}
