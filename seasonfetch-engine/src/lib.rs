mod contract;
mod deduplication;
mod episode;
mod filtering;
mod ranking;
mod validation;

use contract::{Counts, Episode, Input, Output, Recommendations, RejectionReason, ValidationResult};
use deduplication::deduplicate;
use episode::summarize_episode;
use filtering::rejection_reasons;
use ranking::{all_rankings, rank_candidates};
use validation::{validate_candidate, validate_input};

pub use contract::{Input as ContractInput, Output as ContractOutput};

const CONTRACT_VERSION: &str = "seasonfetch.intelligence.v1";

pub fn process(input: Input) -> Output {
    let validation_results: Vec<ValidationResult> = input
        .candidates
        .iter()
        .map(validate_candidate)
        .collect();

    let validated: Vec<_> = input
        .candidates
        .iter()
        .zip(&validation_results)
        .filter(|(_, result)| result.status != "invalid")
        .map(|(candidate, _)| candidate)
        .collect();

    let eligible: Vec<_> = validated
        .iter()
        .copied()
        .filter(|candidate| {
            rejection_reasons(
                candidate,
                &input.request.filters,
                &input.request.audio_mode,
            )
            .is_empty()
        })
        .collect();

    let mut rejected_ids = Vec::new();
    let mut all_rejection_reasons: Vec<RejectionReason> = Vec::new();
    for (candidate, validation) in input.candidates.iter().zip(&validation_results) {
        let reasons = if validation.status == "invalid" {
            validation.warnings.clone()
        } else {
            rejection_reasons(
                candidate,
                &input.request.filters,
                &input.request.audio_mode,
            )
        };
        if !reasons.is_empty() {
            rejected_ids.push(candidate.id.clone());
            all_rejection_reasons.push(RejectionReason {
                candidate_id: candidate.id.clone(),
                reasons,
            });
        }
    }

    let eligible_ids = eligible
        .iter()
        .map(|candidate| candidate.id.clone())
        .collect::<Vec<_>>();
    let deduplicated = deduplicate(&eligible);
    let representatives = deduplicated.representatives;
    let rankings = all_rankings(&representatives);
    let selected_rankings = match input.request.profile.as_str() {
        "smallest-acceptable" => rank_candidates(&representatives, "smallest-acceptable"),
        "highest-quality" => rank_candidates(&representatives, "highest-quality"),
        "most-reliable" => rank_candidates(&representatives, "most-reliable"),
        _ => rank_candidates(&representatives, "best-overall"),
    };
    let ranked_ids = selected_rankings
        .iter()
        .map(|candidate| candidate.candidate_id.clone())
        .collect();
    let recommendations = Recommendations {
        best_overall: rankings.best_overall.first().map(|candidate| candidate.candidate_id.clone()),
        smallest_acceptable: rankings
            .smallest_acceptable
            .first()
            .map(|candidate| candidate.candidate_id.clone()),
        highest_quality: rankings
            .highest_quality
            .first()
            .map(|candidate| candidate.candidate_id.clone()),
        most_reliable: rankings
            .most_reliable
            .first()
            .map(|candidate| candidate.candidate_id.clone()),
    };
    let episode = summarize_episode(representatives.len());
    Output {
        contract_version: CONTRACT_VERSION.to_string(),
        status: "ok".to_string(),
        counts: Counts {
            discovered: input.candidates.len(),
            validated: validated.len(),
            eligible: eligible.len(),
            rejected: rejected_ids.len(),
            unique: representatives.len(),
        },
        eligible_ids,
        eligible_representative_ids: representatives
            .iter()
            .map(|candidate| candidate.id.clone())
            .collect(),
        rejected_ids,
        validation_results,
        rejection_reasons: all_rejection_reasons,
        duplicate_groups: deduplicated.groups,
        ranked_ids,
        rankings,
        recommendations,
        episode,
    }
}

pub fn process_json(json: &str) -> Result<String, String> {
    let input: Input = serde_json::from_str(json).map_err(|error| error.to_string())?;
    validate_input(&input)?;
    serde_json::to_string(&process(input)).map_err(|error| error.to_string())
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn process_json_wasm(json: &str) -> Result<String, wasm_bindgen::JsValue> {
    process_json(json).map_err(|error| wasm_bindgen::JsValue::from_str(&error))
}

#[cfg(test)]
mod tests {
    use super::process_json;
    use serde_json::{json, Value};

    const FIXTURES: &str = include_str!("../../contracts/fixtures/intelligence-v1.json");

    fn candidate(id: &str, hash: &str, resolution: &str, audio: &str) -> Value {
        json!({
            "id": id,
            "title": id,
            "infoHash": hash,
            "fileIdx": 0,
            "resolution": resolution,
            "codec": null,
            "hdr": null,
            "container": "mkv",
            "sizeBytes": 500,
            "seeders": 10,
            "provider": "Torrentio",
            "releaseType": null,
            "releaseGroup": null,
            "metadataCompleteness": 4,
            "audio": {
                "classification": audio,
                "languages": [],
                "confidence": 0,
                "evidence": []
            }
        })
    }

    fn request(audio_mode: &str) -> Value {
        json!({
            "season": 1,
            "episode": 1,
            "profile": "best-overall",
            "audioMode": audio_mode,
            "filters": {
                "resolution": "1080p",
                "maxSizeBytes": null,
                "minSeeders": null,
                "codec": null,
                "hdr": null
            }
        })
    }

    #[test]
    fn compiled_engine_processes_every_migration_contract_fixture() {
        let fixtures: Vec<Value> = serde_json::from_str(FIXTURES).expect("fixture JSON is valid");
        assert!(fixtures.len() >= 6, "fixture corpus should cover six synthetic cases");
        for fixture in fixtures {
            let input = fixture.get("input").expect("fixture has input");
            let output: Value = serde_json::from_str(
                &process_json(&input.to_string()).expect("fixture should process"),
            )
            .expect("engine output is valid JSON");
            assert_eq!(output["contractVersion"], "seasonfetch.intelligence.v1");
            assert_eq!(output["status"], "ok");
            assert!(output.get("counts").is_some());
            assert!(output.get("validationResults").is_some());
            assert!(output.get("rejectionReasons").is_some());
            assert!(output.get("rankings").is_some());
        }
    }

    #[test]
    fn strict_audio_mode_rejects_possible_english_audio() {
        let input = json!({
            "contractVersion": "seasonfetch.intelligence.v1",
            "request": request("english-dubbed-only"),
            "candidates": [
                candidate("possible", &"a".repeat(40), "1080p", "possible-english-audio"),
                candidate("dub", &"b".repeat(40), "1080p", "explicit-english-dub")
            ]
        });
        let output: Value = serde_json::from_str(
            &process_json(&input.to_string()).expect("input should process"),
        )
        .expect("output should be JSON");
        assert_eq!(output["eligibleIds"], json!(["dub"]));
        assert_eq!(output["rejectedIds"], json!(["possible"]));
        assert_eq!(output["rejectionReasons"][0]["reasons"], json!(["english-audio-unconfirmed"]));
    }

    #[test]
    fn duplicate_candidate_ids_are_rejected_at_contract_ingress() {
        let mut first = candidate("same", &"a".repeat(40), "1080p", "unverified");
        let second = first.clone();
        let input = json!({
            "contractVersion": "seasonfetch.intelligence.v1",
            "request": request("any"),
            "candidates": [first.take(), second]
        });
        assert!(process_json(&input.to_string()).is_err());
    }
}
