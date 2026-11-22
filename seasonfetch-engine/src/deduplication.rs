use std::cmp::Ordering;
use std::collections::HashMap;

use crate::contract::{Candidate, DuplicateGroup};

pub struct Deduplicated<'a> {
    pub groups: Vec<DuplicateGroup>,
    pub representatives: Vec<&'a Candidate>,
}

fn title_key(title: &str) -> String {
    title
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn duplicate_key(candidate: &Candidate) -> String {
    match (&candidate.info_hash, candidate.file_idx) {
        (Some(hash), file_idx) => format!(
            "{}:{}",
            hash,
            file_idx.map_or_else(|| "all".to_string(), |index| index.to_string())
        ),
        (None, _) => format!("title:{}", title_key(&candidate.title)),
    }
}

fn known_field_count(candidate: &Candidate) -> usize {
    [
        candidate.resolution.is_some(),
        candidate.codec.is_some(),
        candidate.hdr.is_some(),
        candidate.container.is_some(),
        candidate.size_bytes.is_some(),
        candidate.seeders.is_some(),
        candidate.file_idx.is_some(),
        candidate.release_type.is_some(),
        candidate.release_group.is_some(),
    ]
    .into_iter()
    .filter(|known| *known)
    .count()
        + 1
}

fn audio_evidence_strength(candidate: &Candidate) -> u8 {
    match candidate.audio.classification.as_str() {
        "explicit-english-dub" => 2,
        "possible-english-audio" => 1,
        _ => 0,
    }
}

fn compare_richness(left: &Candidate, right: &Candidate) -> Ordering {
    right
        .metadata_completeness
        .cmp(&left.metadata_completeness)
        .then_with(|| known_field_count(right).cmp(&known_field_count(left)))
        .then_with(|| audio_evidence_strength(right).cmp(&audio_evidence_strength(left)))
        .then_with(|| left.id.cmp(&right.id))
}

pub fn deduplicate<'a>(candidates: &[&'a Candidate]) -> Deduplicated<'a> {
    let mut grouped: HashMap<String, Vec<&Candidate>> = HashMap::new();
    let mut group_order = Vec::new();
    for candidate in candidates {
        let key = duplicate_key(candidate);
        if !grouped.contains_key(&key) {
            group_order.push(key.clone());
        }
        grouped.entry(key).or_default().push(candidate);
    }

    let mut groups = Vec::with_capacity(group_order.len());
    let mut representatives = Vec::with_capacity(group_order.len());
    for key in group_order {
        let members = grouped.remove(&key).unwrap_or_default();
        let representative = members
            .iter()
            .copied()
            .min_by(|left, right| compare_richness(left, right))
            .expect("a duplicate group cannot be empty");
        groups.push(DuplicateGroup {
            id: key,
            candidate_ids: members
                .iter()
                .map(|candidate| candidate.id.clone())
                .collect(),
            representative_id: representative.id.clone(),
        });
        representatives.push(representative);
    }
    Deduplicated {
        groups,
        representatives,
    }
}
