// Shared era data — imported by useWeakKeyScan and VulnerabilityScanner

export const ERA_PHRASES: Record<number, string[]> = {
  2009: ["bitcoin","satoshi","nakamoto","satoshinakamoto","Satoshi Nakamoto","genesis","genesisblock","genesis block","the genesis block","chancellor on brink of second bailout for banks","The Times 03/Jan/2009 Chancellor on brink of second bailout for banks","bitcoin: a peer-to-peer electronic cash system","peer to peer electronic cash","21000000","21million","50btc","hashcash","proof of work","hal finney","nick szabo","wei dai","b-money","blockchain","cryptography","cypherpunk","password","123456","qwerty","test","admin"],
  2010: ["bitcoin","satoshi","mining","miner","block reward","50 btc","gpu mining","pool mining","slush pool","deepbit","blockchain","bitcoin wallet","my bitcoin","password","123456","qwerty","letmein","test","admin","hello world","hello bitcoin","mybitcoin"],
  2011: ["brainwallet","brainflayer","mybitcoin","instawallet","mtgox","mt gox","correct horse battery staple","correct horse battery","the quick brown fox jumps over the lazy dog","to be or not to be","password","password1","123456","qwerty","abc123","letmein","monkey","iloveyou","trustno1","master","dragon","shadow","superman","michael","bitcoin","satoshi","blockchain","wallet","mywallet","btcwallet","1btc","brainwallet test","warpwallet","test","hello world"],
  2012: ["mybitcoin","blockchain","coinbase","bitcoin","wallet","password","123456","brainwallet","warpwallet","test","admin","secret","letmein","qwerty","please work","my wallet","this is my wallet","never mind","open sesame","php bitcoin","server wallet","web wallet","online wallet","this is my private key","do not lose this","keep this safe","my secret key"],
  2013: ["mtgox","mt gox","mark karpeles","gox","bitcoin","blockchain.info","coinbase","android bitcoin","mycelium","bitcoin wallet android","javascript","web wallet","online wallet","password","123456","qwerty","letmein","monkey","dragon","shadow","deadbeef","cafebabe","test","admin","root","user","guest","silk road","ross ulbricht","dread pirate roberts","iloveyou","trustno1"],
  2014: ["android","mycelium","blockchain","coinbase","bitpay","copay","bitcoin wallet","armory","electrum","multibit","password","123456","qwerty","letmein","bitcoin","satoshi","deadbeef","cafebabe","android bitcoin","mobile wallet","secureRandom","entropy bug","iloveyou","trustno1","master","shadow"],
  2015: ["ethereum","Ethereum","ether","vitalik","vitalik buterin","buterin","gavin wood","myetherwallet","web3","web3.js","solidity","the dao","metamask","coinbase","password","123456","qwerty","letmein","0x00","0xdeadbeef","deadbeef","cafebabe","babe","ethereum wallet","frontier","homestead","mist","geth","parity"],
  2016: ["ethereum","the dao","dao hack","thedao","myetherwallet","MyEtherWallet","metamask","MetaMask","web3","solidity","smart contract","geth","parity","vitalik","ether","ETH","coinbase","blockchain","password","123456","qwerty","letmein","iloveyou","hodl","moon","lambo","DAO","decentralized"],
  2017: ["ico","initial coin offering","token sale","hodl","HODL","to the moon","tothemoon","moon","lambo","when lambo","1000x","rekt","wen moon","buy the dip","dyor","fud","fomo","ripple","xrp","litecoin","ltc","dogecoin","doge","monero","xmr","zcash","binance","bittrex","poloniex","kraken","coinbase","metamask","myetherwallet","segwit","bitcoin cash","ethereum","bitcoin","password","123456","qwerty","letmein"],
  2018: ["bitcoin","ethereum","bear market","hodl","buidl","defi","decentralized","metamask","ledger","trezor","hardware wallet","seed phrase","mnemonic","12 words","24 words","bip39","bip44","coinbase","binance","kraken","p2sh","segwit","bitcoin cash","ethereum classic","ripple","xrp","password","123456","qwerty","letmein","iloveyou","diamond hands"],
  2019: ["defi","DeFi","uniswap","compound","maker","dai","ethereum","metamask","bech32","native segwit","lightning network","lightning","lnd","coinbase","binance","kraken","ledger","trezor","seed phrase","password","123456","qwerty","letmein","hodl","moon","lambo","yield farming"],
  2020: ["defi","DeFi summer","yield farming","liquidity mining","uniswap","sushiswap","compound","aave","yearn","curve","sushi","metamask","coinbase","ethereum","bitcoin","gwei","gas fees","layer 2","polygon","matic","nft","NFT","opensea","password","123456","qwerty","letmein","hodl","moon","rekt","wen lambo","diamond hands","gm","wagmi"],
  2021: ["nft","NFT","opensea","bored ape","bayc","cryptopunk","axie infinity","taproot","Taproot","schnorr","bitcoin","ethereum","solana","sol","metamask","coinbase","binance","el salvador","michael saylor","saylor","diamond hands","hodl","moon","doge","shib","wen moon","gm","wagmi","password","123456","qwerty","letmein"],
  2022: ["ethereum","merge","pos","proof of stake","taproot","ordinals","brc-20","bitcoin","metamask","coinbase","ledger","trezor","seed phrase","defi","nft","opensea","blur","layer 2","arbitrum","optimism","zksync","password","123456","qwerty","letmein","hodl","rekt","bear market","gm","wagmi","ngmi"],
  2023: ["ordinals","ordinal","inscription","brc-20","BRC20","bitcoin","ethereum","metamask","coinbase","binance","ledger","trezor","layer 2","arbitrum","optimism","base","zksync","polygon","solana","defi","nft","blur","friend.tech","password","123456","qwerty","letmein","hodl","gm","wagmi"],
  2024: ["bitcoin etf","spot etf","blackrock","fidelity","michael saylor","microstrategy","ethereum","solana","ordinals","runes","bitcoin","metamask","coinbase","ledger","trezor","layer 2","arbitrum","base","zksync","password","123456","qwerty","letmein","hodl","gm","wagmi","ngmi","runes protocol"],
};

export const ERA_HEX_RANGES: Record<number, [number, number][]> = {
  2009: [[1, 100]],
  2010: [[1, 200]],
  2011: [[1, 500]],
  2012: [[1, 500]],
  2013: [[1, 1000]],
  2014: [[1, 1000]],
  2015: [[1, 500]],
  2016: [[1, 500]],
  2017: [[1, 256]],
  2018: [[1, 256]],
  2019: [[1, 128]],
  2020: [[1, 128]],
  2021: [[1, 64]],
  2022: [[1, 64]],
  2023: [[1, 32]],
  2024: [[1, 32]],
};
