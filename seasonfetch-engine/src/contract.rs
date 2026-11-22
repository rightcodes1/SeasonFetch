use serde::{Deserialize, Deserializer, Serialize};

fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    #[serde(rename = "contractVersion")]
    pub contract_version: String,
    pub request: Request,
    pub candidates: Vec<Candidate>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    #[serde(deserialize_with = "required_nullable")]
    pub season: Option<u32>,
    #[serde(deserialize_with = "required_nullable")]
    pub episode: Option<u32>,
    pub profile: String,
    #[serde(rename = "audioMode")]
    pub audio_mode: String,
    pub filters: Filters,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Filters {
    #[serde(deserialize_with = "required_nullable")]
    pub resolution: Option<String>,
    #[serde(rename = "maxSizeBytes", deserialize_with = "required_nullable")]
    pub max_size_bytes: Option<u64>,
    #[serde(rename = "minSeeders", deserialize_with = "required_nullable")]
    pub min_seeders: Option<u64>,
    #[serde(deserialize_with = "required_nullable")]
    pub codec: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub hdr: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Candidate {
    pub id: String,
    pub title: String,
    #[serde(rename = "infoHash", deserialize_with = "required_nullable")]
    pub info_hash: Option<String>,
    #[serde(rename = "fileIdx", deserialize_with = "required_nullable")]
    pub file_idx: Option<u32>,
    #[serde(deserialize_with = "required_nullable")]
    pub resolution: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub codec: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub hdr: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub container: Option<String>,
    #[serde(rename = "sizeBytes", deserialize_with = "required_nullable")]
    pub size_bytes: Option<u64>,
    #[serde(deserialize_with = "required_nullable")]
    pub seeders: Option<u64>,
    #[serde(deserialize_with = "required_nullable")]
    pub provider: Option<String>,
    #[serde(rename = "releaseType", deserialize_with = "required_nullable")]
    pub release_type: Option<String>,
    #[serde(rename = "releaseGroup", deserialize_with = "required_nullable")]
    pub release_group: Option<String>,
    #[serde(rename = "metadataCompleteness")]
    pub metadata_completeness: u8,
    pub audio: Audio,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Audio {
    pub classification: String,
    pub languages: Vec<String>,
    pub confidence: f64,
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub discovered: usize,
    pub validated: usize,
    pub eligible: usize,
    pub rejected: usize,
    pub unique: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub candidate_id: String,
    pub status: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RejectionReason {
    pub candidate_id: String,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub id: String,
    pub candidate_ids: Vec<String>,
    pub representative_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScoreBreakdown {
    pub quality: f64,
    pub size: f64,
    pub seeders: f64,
    pub completeness: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankedCandidate {
    pub candidate_id: String,
    pub score: f64,
    pub score_breakdown: ScoreBreakdown,
    pub explanation: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Rankings {
    #[serde(rename = "bestOverall")]
    pub best_overall: Vec<RankedCandidate>,
    #[serde(rename = "smallestAcceptable")]
    pub smallest_acceptable: Vec<RankedCandidate>,
    #[serde(rename = "highestQuality")]
    pub highest_quality: Vec<RankedCandidate>,
    #[serde(rename = "mostReliable")]
    pub most_reliable: Vec<RankedCandidate>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Recommendations {
    #[serde(rename = "bestOverall")]
    pub best_overall: Option<String>,
    #[serde(rename = "smallestAcceptable")]
    pub smallest_acceptable: Option<String>,
    #[serde(rename = "highestQuality")]
    pub highest_quality: Option<String>,
    #[serde(rename = "mostReliable")]
    pub most_reliable: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Episode {
    pub status: String,
    pub release_count: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Output {
    #[serde(rename = "contractVersion")]
    pub contract_version: String,
    pub status: String,
    pub counts: Counts,
    #[serde(rename = "eligibleIds")]
    pub eligible_ids: Vec<String>,
    #[serde(rename = "eligibleRepresentativeIds")]
    pub eligible_representative_ids: Vec<String>,
    #[serde(rename = "rejectedIds")]
    pub rejected_ids: Vec<String>,
    #[serde(rename = "validationResults")]
    pub validation_results: Vec<ValidationResult>,
    #[serde(rename = "rejectionReasons")]
    pub rejection_reasons: Vec<RejectionReason>,
    #[serde(rename = "duplicateGroups")]
    pub duplicate_groups: Vec<DuplicateGroup>,
    #[serde(rename = "rankedIds")]
    pub ranked_ids: Vec<String>,
    pub rankings: Rankings,
    pub recommendations: Recommendations,
    pub episode: Episode,
}
