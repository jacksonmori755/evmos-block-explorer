import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';

import { Blockscon } from '/imports/api/blocks/blocks.js';
import { Chain } from '/imports/api/chain/chain.js';
import { ValidatorSets } from '/imports/api/validator-sets/validator-sets.js';
import { Validators } from '/imports/api/validators/validators.js';

Meteor.methods({
    'blocks.getLatestHeight': function() {
        this.unblock();
        let url = RPC+'/status';
        try{
            let response = HTTP.get(url);
            let status = JSON.parse(response.content);
            return (status.result.sync_info.latest_block_height);    
        }
        catch (e){
            return 0;
        }
    },
    'blocks.getCurrentHeight': function() {
        this.unblock();
        return (Blockscon.find().count());
    },
    'blocks.blocksUpdate': function() {
        if (SYNCING)
            return "Syncing...";
        // Meteor.clearInterval(Meteor.timerHandle);
        // get the latest height
        let until = Meteor.call('blocks.getLatestHeight');
        // console.log(until);
        // get the current height in db
        let curr = Meteor.call('blocks.getCurrentHeight');
        // console.log(curr);
        // Blockscon.insert({height: 123, hash: "1234", transNum: 1234, time: "1234"});
        // loop if there's update in db
        if (until > curr) {
            SYNCING = true;
            for (let height = curr+1 ; height <= until ; height++) {
                // add timeout here? and outside this loop (for catched up and keep fetching)?
                this.unblock();
                let url = RPC+'/block?height=' + height;
                console.log(url);
                try{
                    let response = HTTP.get(url);
                    if (response.statusCode == 200){
                        let block = JSON.parse(response.content);
                        block = block.result;
                        // store height, hash, numtransaction and time in db
                        let blockData = {};
                        blockData.height = height;
                        blockData.hash = block.block_meta.block_id.hash;
                        blockData.transNum = block.block_meta.header.num_txs;
                        blockData.time = block.block.header.time;
                        blockData.lastBlockHash = block.block.header.last_block_id.hash;
                        blockData.validators = [];
                        let precommits = block.block.last_commit.precommits;
                        if (precommits != null){
                            console.log(precommits.length);
                            for (let i=0; i<precommits.length; i++){
                                if (precommits[i] != null){
                                    blockData.validators.push(precommits[i].validator_address);
                                }
                            }    
                        }
                        Blockscon.insert(blockData);
        
                        url = RPC+'/validators?height='+height;
                        response = HTTP.get(url);
                        let validators = JSON.parse(response.content);
                        ValidatorSets.insert(validators.result);
                        let chainStatus = Chain.findOne({chainId:block.block_meta.header.chain_id});
                        // console.log(chainStatus);
                        let lastSyncedTime = chainStatus.lastSyncedTime;
                        let timeDiff;
                        let blockTime = Meteor.settings.params.defaultBlockTime;
                        if (lastSyncedTime){
                            let dateLatest = new Date(blockData.time);
                            let dateLast = new Date(lastSyncedTime);
                            timeDiff = Math.abs(dateLatest.getTime() - dateLast.getTime());
                            blockTime = (chainStatus.blockTime * (blockData.height - 1) + timeDiff) / blockData.height;
                        }

                        Chain.update({chainId:block.block_meta.header.chain_id}, {$set:{lastSyncedTime:blockData.time, blockTime:blockTime}});

                        if (height == 1){
                            Validators.remove({});
                            url = LCD+'/stake/validators';
                            response = HTTP.get(url);
                            let validatorSet = JSON.parse(response.content);
                        
                            for (v in validators.result.validators){
                                // Validators.insert(validators.result.validators[v]);
                                let validator = validators.result.validators[v];

                                let command = Meteor.settings.bin.gaiadebug+" pubkey "+validator.pub_key.value;
                                Meteor.call('runCode', command, function(error, result){
                                    validator.address = result.match(/\s[0-9A-F]{40}$/igm);
                                    validator.address = validator.address[0].trim();
                                    validator.hex = result.match(/\s[0-9A-F]{64}$/igm);
                                    validator.hex = validator.hex[0].trim();
                                    validator.cosmosaccpub = result.match(/cosmosaccpub.*$/igm);
                                    validator.cosmosaccpub = validator.cosmosaccpub[0].trim();
                                    validator.pub_key = result.match(/cosmosvalpub.*$/igm);
                                    validator.pub_key = validator.pub_key[0].trim();

                                    for (val in validatorSet){
                                        if (validatorSet[val].pub_key == validator.cosmosvalpub){
                                            validator.owner = validatorSet[val].owner;
                                            validatorSet.splice(val, 1);
                                            break;
                                        }
                                    }

                                    // console.log(validator);
                                    Validators.insert(validator);
                                });
                            }
                        }

                    }                    
                }
                catch (e){
                    console.log(e);
                    SYNCING = false;
                    return "Stopped";
                }
            }
            SYNCING = false;
        }
        
        return until;
    },
    'addLimit': function(limit) {
        // console.log(limit+10)
        return (limit+10);
    },
    'hasMore': function(limit) {
        if (limit > Meteor.call('getCurrentHeight')) {
            return (false);
        } else {
            return (true);
        }
    }
});