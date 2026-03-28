#[starknet::interface]
trait ICreditProofVerifier<TContractState> {
    fn verify_credit_proof(
        ref self: TContractState,
        wallet: starknet::ContractAddress,
        score: u32,
        threshold: u32,
        requested_tier: u8,
        proof_nonce: felt252
    ) -> bool;

    fn check_proof_valid(
        self: @TContractState,
        wallet: starknet::ContractAddress
    ) -> (bool, u8);

    fn get_tier_threshold(self: @TContractState, tier: u8) -> u32;
}

#[starknet::contract]
mod CreditProofVerifier {
    use starknet::ContractAddress;
    use starknet::get_block_timestamp;
    use starknet::storage::Map;
    use starknet::storage::StorageMapReadAccess;
    use starknet::storage::StorageMapWriteAccess;

    #[storage]
    struct Storage {
        verified_wallets: Map::<ContractAddress, u64>,
        wallet_tier: Map::<ContractAddress, u8>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        ProofVerified: ProofVerified,
        ProofRejected: ProofRejected,
    }

    #[derive(Drop, starknet::Event)]
    struct ProofVerified {
        #[key]
        wallet: ContractAddress,
        tier: u8,
        timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct ProofRejected {
        #[key]
        wallet: ContractAddress,
        reason: felt252,
    }

    #[abi(embed_v0)]
    impl CreditProofVerifierImpl of super::ICreditProofVerifier<ContractState> {
        fn verify_credit_proof(
            ref self: ContractState,
            wallet: ContractAddress,
            score: u32,
            threshold: u32,
            requested_tier: u8,
            proof_nonce: felt252
        ) -> bool {
            let tier_valid = self._validate_tier(score, requested_tier);
            if !tier_valid {
                self.emit(ProofRejected { wallet, reason: 'INVALID_TIER' });
                return false;
            }
            if score < threshold {
                self.emit(ProofRejected { wallet, reason: 'BELOW_THRESHOLD' });
                return false;
            }
            let timestamp = get_block_timestamp();
            self.verified_wallets.write(wallet, timestamp);
            self.wallet_tier.write(wallet, requested_tier);
            self.emit(ProofVerified { wallet, tier: requested_tier, timestamp });
            true
        }

        fn check_proof_valid(
            self: @ContractState,
            wallet: ContractAddress
        ) -> (bool, u8) {
            let proof_time = self.verified_wallets.read(wallet);
            if proof_time == 0 {
                return (false, 0);
            }
            let current_time = get_block_timestamp();
            let is_valid = (current_time - proof_time) < 3600_u64;
            let tier = self.wallet_tier.read(wallet);
            (is_valid, tier)
        }

        fn get_tier_threshold(self: @ContractState, tier: u8) -> u32 {
            if tier == 4 { return 850; }
            if tier == 3 { return 700; }
            if tier == 2 { return 550; }
            if tier == 1 { return 400; }
            0
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _validate_tier(self: @ContractState, score: u32, tier: u8) -> bool {
            if tier == 4 { return score >= 850; }
            if tier == 3 { return score >= 700; }
            if tier == 2 { return score >= 550; }
            if tier == 1 { return score >= 400; }
            false
        }
    }
}

mod tests;