//! The way a layers scene's request token travels: a port of shared/layers.mjs.

use crate::targets::{resolve_ref, step_targets};
use serde_json::Value;

use crate::states::list;

/// The item key ("l:id" or "i:id") a path stop names, or None.
fn stop_key(scene: &Value, r: &Value) -> Option<String> {
    if !r.is_string() {
        return None;
    }
    let keys = resolve_ref(scene, r)?;
    (keys.len() == 1).then(|| keys[0].clone())
}

/// Index of the layer an item key sits in, or None.
pub fn layer_of(scene: &Value, key: &str) -> Option<usize> {
    let id = &key[2..];
    list(scene, "layers").iter().position(|l| {
        if key.starts_with("l:") {
            l.get("id").and_then(Value::as_str) == Some(id)
        } else {
            list(l, "items").iter().any(|it| it.get("id").and_then(Value::as_str) == Some(id))
        }
    })
}

#[derive(Clone, Debug)]
pub struct Visit {
    pub key: String,
    /// On the way down (true) or back up.
    pub down: bool,
}

pub struct Route {
    pub visits: Vec<Visit>,
    pub turn: i64,
    /// Keys of the stops never reached because a `skip` answered first.
    pub skipped: Vec<String>,
}

/// The token's visits in order, the stop it turns back at, and the stops it never reaches (`layerRoute`).
pub fn layer_route(scene: &Value) -> Route {
    let path = scene.get("path");
    let keys: Vec<Option<String>> =
        path.map_or(&[][..], |p| list(p, "stops")).iter().map(|r| stop_key(scene, r)).collect();
    if keys.is_empty() {
        return Route { visits: vec![], turn: -1, skipped: vec![] };
    }
    let path = path.unwrap();
    let skip = path.get("skip").filter(|s| !s.is_null() && s.as_bool() != Some(false));
    let at = skip
        .and_then(|s| s.get("at"))
        .and_then(|a| stop_key(scene, a))
        .and_then(|k| keys.iter().position(|x| x.as_deref() == Some(k.as_str())))
        .map(|i| i as i64)
        .unwrap_or(-1);
    let turn = if at >= 0 { at } else { keys.len() as i64 - 1 };
    let reached: Vec<Visit> =
        keys[..=(turn as usize)].iter().map(|k| Visit { key: k.clone().unwrap_or_default(), down: true }).collect();
    let back = skip.is_some() && at >= 0 || path.get("return").and_then(Value::as_bool) == Some(true);
    let mut visits = reached.clone();
    if back {
        visits.extend(reached.iter().rev().map(|v| Visit { down: false, ..v.clone() }));
    }
    let skipped = keys[(turn as usize + 1)..].iter().flatten().cloned().collect();
    Route { visits, turn, skipped }
}

/// Where the token is after each step, as an index into the route's visits (-1 before it has set out): a step that
/// focuses stops moves it to the furthest of them, each at its first visit from where the token is, so it never
/// moves back (`tokenSteps`).
pub fn token_steps(scene: &Value) -> Vec<i64> {
    let route = layer_route(scene);
    let visits = &route.visits;
    let stop_keys: Vec<Option<String>> =
        scene.get("path").map_or(&[][..], |p| list(p, "stops")).iter().map(|r| stop_key(scene, r)).collect();
    let is_stop = |k: &str| stop_keys.iter().any(|s| s.as_deref() == Some(k));
    let mut pos = -1i64;
    // Focusing the stop the token sits on, where the route turns back through it, turns the token back.
    let turns_here = |at: i64, key: &str| {
        at >= 0
            && visits.get(at as usize).is_some_and(|v| v.key == key)
            && visits.get(at as usize + 1).is_some_and(|v| v.key == key)
    };
    step_targets(scene)
        .iter()
        .map(|keys| {
            let next: Vec<i64> = keys
                .iter()
                .filter(|k| is_stop(k))
                .map(|key| {
                    if turns_here(pos, key) {
                        pos + 1
                    } else {
                        visits
                            .iter()
                            .enumerate()
                            .position(|(i, v)| i as i64 >= pos.max(0) && &v.key == key)
                            .map_or(-1, |i| i as i64)
                    }
                })
                .collect();
            pos = next.iter().fold(pos, |m, &n| m.max(n));
            pos
        })
        .collect()
}
