use crate::contract::{Candidate, Filters};

pub fn rejection_reasons(
    candidate: &Candidate,
    filters: &Filters,
    audio_mode: &str,
) -> Vec<String> {
    let mut reasons = Vec::new();

    if let Some(resolution) = filters.resolution.as_deref() {
        if resolution != "any" && candidate.resolution.as_deref() != Some(resolution) {
            reasons.push("resolution-mismatch".to_string());
        }
    }
    if let Some(max_size) = filters.max_size_bytes {
        match candidate.size_bytes {
            None => reasons.push("size-unknown".to_string()),
            Some(size) if size > max_size => reasons.push("size-over-limit".to_string()),
            Some(_) => {}
        }
    }
    if let Some(min_seeders) = filters.min_seeders {
        match candidate.seeders {
            None => reasons.push("seeders-unknown".to_string()),
            Some(seeders) if seeders < min_seeders => {
                reasons.push("seeders-below-minimum".to_string())
            }
            Some(_) => {}
        }
    }
    if let Some(codec) = filters.codec.as_deref() {
        if candidate.codec.as_deref() != Some(codec) {
            reasons.push("codec-mismatch".to_string());
        }
    }
    if let Some(hdr) = filters.hdr.as_deref() {
        if candidate.hdr.as_deref() != Some(hdr) {
            reasons.push("hdr-mismatch".to_string());
        }
    }
    match audio_mode {
        "english-dubbed-only" if candidate.audio.classification != "explicit-english-dub" => {
            reasons.push("english-audio-unconfirmed".to_string());
        }
        "english-dubbed-or-dual"
            if !matches!(
                candidate.audio.classification.as_str(),
                "explicit-english-dub" | "possible-english-audio"
            ) =>
        {
            reasons.push("english-audio-unconfirmed".to_string());
        }
        _ => {}
    }
    reasons
}
