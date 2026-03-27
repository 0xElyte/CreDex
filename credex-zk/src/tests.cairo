#[cfg(test)]
mod tests {
    use starknet::ContractAddress;
    use starknet::contract_address_const;
    use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};
    use snforge_std::cheatcodes::execution_info::block_timestamp::{
        start_cheat_block_timestamp,
        stop_cheat_block_timestamp
    };
    use credex_zk::{
        ICreditProofVerifierDispatcher,
        ICreditProofVerifierDispatcherTrait
    };

    // Deploys a fresh contract instance for each test
    fn deploy_contract() -> ICreditProofVerifierDispatcher {
        let contract = declare("CreditProofVerifier").unwrap().contract_class();
        let (contract_address, _) = contract.deploy(@array![]).unwrap();
        ICreditProofVerifierDispatcher { contract_address }
    }

    // Fake borrower wallet — just a made-up address for testing
    fn wallet() -> ContractAddress {
        contract_address_const::<0x123>()
    }

    // -------------------------------------------------------------------------
    // TESTS
    // -------------------------------------------------------------------------

    // Score 900 claiming Platinum (needs 850) — should pass
    #[test]
    fn test_platinum_approved() {
        let contract = deploy_contract();
        start_cheat_block_timestamp(contract.contract_address, 1000);

        let result = contract.verify_credit_proof(wallet(), 900, 850, 4, 'nonce1');
        assert(result == true, 'Platinum should pass');

        // Also check that storage was actually written correctly
        let (valid, tier) = contract.check_proof_valid(wallet());
        assert(valid == true, 'Proof should be valid');
        assert(tier == 4, 'Tier should be 4');

        stop_cheat_block_timestamp(contract.contract_address);
    }

    // Score 750 claiming Gold (needs 700) — should pass
    #[test]
    fn test_gold_approved() {
        let contract = deploy_contract();
        start_cheat_block_timestamp(contract.contract_address, 1000);

        let result = contract.verify_credit_proof(wallet(), 750, 700, 3, 'nonce2');
        assert(result == true, 'Gold should pass');

        stop_cheat_block_timestamp(contract.contract_address);
    }

    // Score 600 claiming Gold (needs 700) — should fail
    // Tests that you cannot lie about your tier
    #[test]
    fn test_score_below_threshold_rejected() {
        let contract = deploy_contract();
        start_cheat_block_timestamp(contract.contract_address, 1000);

        let result = contract.verify_credit_proof(wallet(), 600, 700, 3, 'nonce3');
        assert(result == false, 'Should be rejected');

        stop_cheat_block_timestamp(contract.contract_address);
    }

    // Score 300 — below Bronze minimum of 400 — should fail
    #[test]
    fn test_denied_score_rejected() {
        let contract = deploy_contract();
        start_cheat_block_timestamp(contract.contract_address, 1000);

        let result = contract.verify_credit_proof(wallet(), 300, 400, 1, 'nonce4');
        assert(result == false, 'Score 300 should be denied');

        stop_cheat_block_timestamp(contract.contract_address);
    }

    // Verify at time 1000, then jump 2 hours forward — proof should be expired
    // Our contract rejects proofs older than 1 hour (3600 seconds)
    #[test]
    fn test_proof_expires() {
        let contract = deploy_contract();
        start_cheat_block_timestamp(contract.contract_address, 1000);

        contract.verify_credit_proof(wallet(), 900, 850, 4, 'nonce5');

        // Stop the old timestamp, jump forward 2 hours
        stop_cheat_block_timestamp(contract.contract_address);
        start_cheat_block_timestamp(contract.contract_address, 1000 + 7201);

        let (valid, _) = contract.check_proof_valid(wallet());
        assert(valid == false, 'Proof should be expired');

        stop_cheat_block_timestamp(contract.contract_address);
    }

    // Wallet that never called verify_credit_proof — should have no proof
    // Unset Map keys return 0, which our contract treats as no proof exists
    #[test]
    fn test_no_proof_wallet() {
        let contract = deploy_contract();

        let fresh = contract_address_const::<0x999>();
        let (valid, tier) = contract.check_proof_valid(fresh);
        assert(valid == false, 'Should have no proof');
        assert(tier == 0, 'Tier should be zero');
    }
}