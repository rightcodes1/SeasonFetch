use std::collections::HashSet;

use crate::contract::{Candidate, Input, ValidationResult};

const CONTRACT_VERSION: &str = "seasonfetch.intelligence.v1";
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const PROFILES: [&str; 4] = [
    "best-overall",
    "smallest-acceptable",
    "highest-quality",
    "most-reliable",
];
const RESOLUTIONS: [&str; 7] = ["480p", "576p", "720p", "1080p", "1440p", "2160p", "any"];
const CANDIDATE_RESOLUTIONS: [&str; 6] = ["480p", "576p", "720p", "1080p", "1440p", "2160p"];
const CODECS: [&str; 3] = ["H.264", "HEVC", "AV1"];
const HDR_TYPES: [&str; 2] = ["HDR", "Dolby Vision"];
const AUDIO_MODES: [&str; 3] = ["any", "english-dubbed-only", "english-dubbed-or-dual"];
const AUDIO_CLASSES: [&str; 3] = [
    "explicit-english-dub",
    "possible-english-audio",
    "unverified",
];

pub fn validate_input(input: &Input) -> Result<(), String> {
    if input.contract_version != CONTRACT_VERSION {
        return Err(format!(
            "unsupported contract version: {}",
            input.contract_version
        ));
    }
    if input.request.episode == Some(0) {
        return Err("request.episode must be at least 1".to_string());
    }
    if !PROFILES.contains(&input.request.profile.as_str()) {
        return Err("request.profile is not a supported recommendation profile".to_string());
    }
    if !AUDIO_MODES.contains(&input.request.audio_mode.as_str()) {
        return Err("request.audioMode is not a supported audio mode".to_string());
    }
    if let Some(resolution) = &input.request.filters.resolution {
        if !RESOLUTIONS.contains(&resolution.as_str()) {
            return Err("request.filters.resolution is not supported".to_string());
        }
    }
    if let Some(size) = input.request.filters.max_size_bytes {
        if size == 0 || size > MAX_SAFE_INTEGER {
            return Err("request.filters.maxSizeBytes must be a positive safe integer".to_string());
        }
    }
    if input
        .request
        .filters
        .min_seeders
        .is_some_and(|value| value > MAX_SAFE_INTEGER)
    {
        return Err("request.filters.minSeeders exceeds the safe integer limit".to_string());
    }
    if let Some(codec) = &input.request.filters.codec {
        if !CODECS.contains(&codec.as_str()) {
            return Err("request.filters.codec is not supported".to_string());
        }
    }
    if let Some(hdr) = &input.request.filters.hdr {
        if !HDR_TYPES.contains(&hdr.as_str()) {
            return Err("request.filters.hdr is not supported".to_string());
        }
    }
    if input.candidates.len() > 1_000 {
        return Err("candidates exceeds the contract limit of 1000".to_string());
    }

    let mut ids = HashSet::new();
    for candidate in &input.candidates {
        if candidate.id.is_empty()
            || candidate.id.chars().count() > 256
            || !ids.insert(candidate.id.as_str())
        {
            return Err("candidate IDs must be unique and 1-256 characters".to_string());
        }
        if candidate.title.chars().count() > 2_000 {
            return Err(format!(
                "candidate {} title exceeds the contract limit",
                candidate.id
            ));
        }
        if candidate
            .resolution
            .as_deref()
            .is_some_and(|value| !CANDIDATE_RESOLUTIONS.contains(&value))
        {
            return Err(format!(
                "candidate {} has unsupported resolution",
                candidate.id
            ));
        }
        if candidate
            .codec
            .as_deref()
            .is_some_and(|value| !CODECS.contains(&value))
        {
            return Err(format!("candidate {} has unsupported codec", candidate.id));
        }
        if candidate
            .hdr
            .as_deref()
            .is_some_and(|value| !HDR_TYPES.contains(&value))
        {
            return Err(format!(
                "candidate {} has unsupported HDR type",
                candidate.id
            ));
        }
        if let Some(hash) = &candidate.info_hash {
            if hash.len() != 40
                || !hash.chars().all(|character| {
                    character.is_ascii_hexdigit() && !character.is_ascii_uppercase()
                })
            {
                return Err(format!(
                    "candidate {} has an invalid lowercase infoHash",
                    candidate.id
                ));
            }
        }
        if candidate.metadata_completeness > 7 {
            return Err(format!(
                "candidate {} has invalid metadataCompleteness",
                candidate.id
            ));
        }
        if candidate
            .size_bytes
            .is_some_and(|value| value > MAX_SAFE_INTEGER)
            || candidate
                .seeders
                .is_some_and(|value| value > MAX_SAFE_INTEGER)
        {
            return Err(format!(
                "candidate {} contains a value beyond the safe integer limit",
                candidate.id
            ));
        }
        for (field, value, max_chars) in [
            ("codec", candidate.codec.as_deref(), 32),
            ("hdr", candidate.hdr.as_deref(), 32),
            ("container", candidate.container.as_deref(), 32),
            ("provider", candidate.provider.as_deref(), 128),
            ("releaseType", candidate.release_type.as_deref(), 64),
            ("releaseGroup", candidate.release_group.as_deref(), 128),
        ] {
            if value.is_some_and(|text| text.chars().count() > max_chars) {
                return Err(format!(
                    "candidate {} {field} exceeds the contract limit",
                    candidate.id
                ));
            }
        }
        if !AUDIO_CLASSES.contains(&candidate.audio.classification.as_str()) {
            return Err(format!(
                "candidate {} has invalid audio classification",
                candidate.id
            ));
        }
        if !candidate.audio.confidence.is_finite()
            || !(0.0..=1.0).contains(&candidate.audio.confidence)
        {
            return Err(format!(
                "candidate {} has invalid audio confidence",
                candidate.id
            ));
        }
        if candidate.audio.languages.len() > 16
            || candidate.audio.evidence.len() > 16
            || candidate
                .audio
                .languages
                .iter()
                .any(|value| value.chars().count() > 16)
            || candidate
                .audio
                .evidence
                .iter()
                .any(|value| value.chars().count() > 128)
        {
            return Err(format!(
                "candidate {} audio metadata exceeds the contract limit",
                candidate.id
            ));
        }
    }
    Ok(())
}

pub fn validate_candidate(candidate: &Candidate) -> ValidationResult {
    let mut warnings = Vec::new();
    if candidate.info_hash.is_none() {
        warnings.push("missing-info-hash".to_string());
    }
    if candidate.resolution.is_none() {
        warnings.push("unknown-resolution".to_string());
    }
    if candidate.size_bytes.is_none() {
        warnings.push("unknown-size".to_string());
    }
    if candidate.seeders.is_none() {
        warnings.push("unknown-seeders".to_string());
    }
    if candidate.audio.classification == "unverified" {
        warnings.push("unverified-audio".to_string());
    }
    let invalid = warnings
        .iter()
        .any(|warning| warning == "missing-info-hash");
    ValidationResult {
        candidate_id: candidate.id.clone(),
        status: if invalid {
            "invalid"
        } else if warnings.is_empty() {
            "validated"
        } else {
            "partial"
        }
        .to_string(),
        warnings,
    }
}
