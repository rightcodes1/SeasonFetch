use std::cmp::Ordering;

use crate::contract::{Candidate, RankedCandidate, Rankings, ScoreBreakdown};

const PROFILES: [(&str, (f64, f64, f64, f64)); 4] = [
    ("best-overall", (0.35, 0.30, 0.25, 0.10)),
    ("smallest-acceptable", (0.20, 0.55, 0.15, 0.10)),
    ("highest-quality", (0.60, 0.10, 0.20, 0.10)),
    ("most-reliable", (0.15, 0.15, 0.55, 0.15)),
];

fn quality_score(candidate: &Candidate) -> f64 {
    let resolution = match candidate.resolution.as_deref() {
        Some("2160p") => 1.0,
        Some("1440p") => 0.85,
        Some("1080p") => 0.7,
        Some("720p") => 0.45,
        Some("576p") => 0.25,
        Some("480p") => 0.15,
        _ => 0.0,
    };
    resolution
        + if candidate.hdr.is_some() { 0.1 } else { 0.0 }
        + if matches!(candidate.codec.as_deref(), Some("HEVC") | Some("AV1")) {
            0.08
        } else {
            0.0
        }
}

fn score(candidate: &Candidate, profile: &str, max_size: f64, max_seeders: f64) -> RankedCandidate {
    let quality = quality_score(candidate);
    let size = candidate.size_bytes.map_or(0.0, |value| {
        if max_size > 0.0 {
            (1.0 - value as f64 / max_size).max(0.0)
        } else {
            0.0
        }
    });
    let seeders = candidate.seeders.map_or(0.0, |value| {
        if max_seeders > 0.0 {
            (value as f64 / max_seeders).min(1.0)
        } else {
            0.0
        }
    });
    let completeness = (candidate.metadata_completeness as f64 / 7.0).min(1.0);
    let weights = PROFILES
        .iter()
        .find(|(name, _)| *name == profile)
        .map(|(_, weights)| *weights)
        .unwrap_or(PROFILES[0].1);
    let total =
        quality * weights.0 + size * weights.1 + seeders * weights.2 + completeness * weights.3;
    let breakdown = ScoreBreakdown {
        quality,
        size,
        seeders,
        completeness,
    };
    let explanation = format!(
        "quality {}%, size {}%, seeders {}%, metadata {}%",
        (quality * 100.0).round() as u32,
        (size * 100.0).round() as u32,
        (seeders * 100.0).round() as u32,
        (completeness * 100.0).round() as u32,
    );
    RankedCandidate {
        candidate_id: candidate.id.clone(),
        score: total,
        score_breakdown: breakdown,
        explanation,
    }
}

pub fn rank_candidates(candidates: &[&Candidate], profile: &str) -> Vec<RankedCandidate> {
    let max_size = candidates
        .iter()
        .filter_map(|candidate| candidate.size_bytes)
        .max()
        .unwrap_or(0) as f64;
    let max_seeders = candidates
        .iter()
        .filter_map(|candidate| candidate.seeders)
        .max()
        .unwrap_or(0) as f64;
    let mut ranked = candidates
        .iter()
        .map(|candidate| score(candidate, profile, max_size, max_seeders))
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| {
                let left_seeders = candidates
                    .iter()
                    .find(|candidate| candidate.id == left.candidate_id)
                    .and_then(|candidate| candidate.seeders)
                    .map(|value| value as i64)
                    .unwrap_or(-1);
                let right_seeders = candidates
                    .iter()
                    .find(|candidate| candidate.id == right.candidate_id)
                    .and_then(|candidate| candidate.seeders)
                    .map(|value| value as i64)
                    .unwrap_or(-1);
                right_seeders.cmp(&left_seeders)
            })
            .then_with(|| left.candidate_id.cmp(&right.candidate_id))
    });
    ranked
}

pub fn all_rankings(candidates: &[&Candidate]) -> Rankings {
    Rankings {
        best_overall: rank_candidates(candidates, "best-overall"),
        smallest_acceptable: rank_candidates(candidates, "smallest-acceptable"),
        highest_quality: rank_candidates(candidates, "highest-quality"),
        most_reliable: rank_candidates(candidates, "most-reliable"),
    }
}
