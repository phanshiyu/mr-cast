use super::{SceneInput, SceneView};
pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    Ok(super::placeholder::view(input, None))
}
