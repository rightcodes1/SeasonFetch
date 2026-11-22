use crate::contract::Episode;

pub fn summarize_episode(unique_eligible_count: usize) -> Episode {
    Episode {
        status: if unique_eligible_count > 0 {
            "available"
        } else {
            "missing"
        }
        .to_string(),
        release_count: unique_eligible_count,
        warnings: if unique_eligible_count > 0 {
            Vec::new()
        } else {
            vec!["no-usable-releases".to_string()]
        },
    }
}
