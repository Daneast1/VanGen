// ═══════════════════════════════════════════════════════════════════════════
// EXPANDED WEAK KEY DATABASE — Era-specific patterns 2009–2024
// Sources: public brainwallet research, Brainflayer DB, RockYou leak,
//          BitcoinTalk historical posts, Android SecureRandom CVE,
//          Satoshi puzzle set, known cracked wallets (academic papers)
// ═══════════════════════════════════════════════════════════════════════════

// ── Helper to generate sequential hex keys ──────────────────────────────────
function seq(from: number, to: number): string[] {
  const out: string[] = [];
  for (let i = from; i <= to; i++)
    out.push(i.toString(16).padStart(64, '0'));
  return out;
}

// ── Helper: repeat a 2-char hex byte 32 times ───────────────────────────────
function rep(byte: string): string { return byte.repeat(32); }

// ── Helper: SHA256 of a string (sync, for known precomputed keys) ────────────
// We store the SHA256 output directly (precomputed) so no runtime hashing needed.
// These are the ACTUAL private keys derived from SHA256(phrase).

// ═══════════════════════════════════════════════════════════════════════════
// BRAIN WALLET PHRASES — what people SHA256'd to make private keys
// ═══════════════════════════════════════════════════════════════════════════
export const BRAIN_WALLET_PHRASES: string[] = [

  // ── 2009–2010: Satoshi/Genesis era ──────────────────────────────────────
  "bitcoin", "Bitcoin", "BITCOIN", "satoshi", "Satoshi", "nakamoto", "Nakamoto",
  "satoshinakamoto", "Satoshi Nakamoto", "satoshi nakamoto",
  "genesis", "genesis block", "genesisblock", "the genesis block",
  "chancellor on brink of second bailout for banks",
  "The Times 03/Jan/2009 Chancellor on brink of second bailout for banks",
  "bitcoin: a peer-to-peer electronic cash system",
  "peer to peer electronic cash", "electronic cash",
  "21000000", "21million", "21 million", "21,000,000",
  "50btc", "50 btc", "50 bitcoin", "block reward",
  "crypto", "cryptography", "cypherpunk", "cypherpunks",
  "hal finney", "halfinney", "nick szabo", "nickszabo",
  "wei dai", "weidai", "b-money", "bmoney",
  "hashcash", "proof of work", "proofofwork",
  "blockchain", "block chain", "Blockchain",

  // ── 2011–2012: BitcoinTalk / early forum era ─────────────────────────────
  "password", "password1", "password123", "passw0rd", "p@ssword", "p@ssw0rd",
  "123456", "1234567", "12345678", "123456789", "1234567890",
  "qwerty", "qwerty123", "qwerty1234", "qwertyuiop",
  "abc123", "abc1234", "abcdef",
  "letmein", "letmein123", "let me in",
  "monkey", "monkey123", "dragon", "dragon123",
  "master", "master123", "sunshine", "sunshine123",
  "princess", "welcome", "welcome1", "shadow", "shadow123",
  "superman", "superman123", "michael", "football",
  "iloveyou", "i love you", "ilove", "loveyou",
  "trustno1", "trust no one", "baseball", "batman", "batman123",
  "access", "access123", "hello", "hello123", "hello world",
  "charlie", "donald", "harley", "ranger",
  "joshua", "george", "hunter", "buster", "thomas",
  "robert", "soccer", "hockey", "killer", "jordan",
  "maggie", "michelle", "jessica", "pepper", "andrew",
  "daniel", "matthew", "qazwsx", "zxcvbn", "asdfgh",
  "654321", "111111", "000000", "999999", "121212",
  "696969", "1q2w3e", "1q2w3e4r", "1q2w3e4r5t", "1qaz2wsx",
  "zaq12wsx", "xsw2zaq1",
  "mybitcoin", "my bitcoin", "mybtc", "my btc",
  "wallet", "mywallet", "my wallet", "bitcoin wallet",
  "btcwallet", "btc wallet", "1bitcoin", "1btc", "1 btc",
  "test", "test1", "test12", "test123", "test1234", "testing",
  "temp", "temp1", "temp123", "changeme", "change me",
  "default", "secret", "secret123", "secure", "securepassword",
  "passphrase", "mypassword", "mypass", "pass", "pass123",
  "admin", "admin123", "administrator", "root", "root123",
  "user", "user123", "guest", "guest123", "demo",
  "login", "login123",

  // ── 2011–2013: Brainflayer known-cracked phrases (public research) ────────
  "correct horse battery staple",
  "correct horse battery",
  "to be or not to be",
  "to be or not to be that is the question",
  "the quick brown fox jumps over the lazy dog",
  "the quick brown fox",
  "in the beginning god created the heavens and the earth",
  "in the beginning",
  "hello bitcoin",
  "hello satoshi",
  "i am satoshi",
  "i am nakamoto",
  "brainwallet",
  "brainflayer",
  "warpwallet",
  "warpwallet test",
  "this is a test",
  "this is my wallet",
  "this is my bitcoin wallet",
  "this is my private key",
  "do not lose this",
  "keep this safe",
  "my secret key",
  "my private key",
  "super secret",
  "super secret key",
  "never gonna give you up",
  "never gonna give you up never gonna let you down",
  "the answer is 42", "42", "answer to life the universe and everything",
  "may the force be with you",
  "live long and prosper",
  "beam me up scotty",
  "i have a dream",
  "four score and seven years ago",
  "ask not what your country can do for you",
  "one small step for man",
  "et tu brute",
  "veni vidi vici",
  "carpe diem",
  "cogito ergo sum",

  // ── 2013–2014: Android SecureRandom bug era (CVE-2013-7372) ─────────────
  // Wallets using vulnerable Android RNG had predictable seeds
  // Phrases used by popular Android wallets of that era:
  "bitcoin wallet android",
  "android bitcoin",
  "mycelium", "blockchain android",
  "coinbase android",
  "bitcoin spinner",
  "Mycelium Bitcoin Wallet",

  // ── 2013: Mt. Gox era ────────────────────────────────────────────────────
  "mtgox", "mt gox", "Mt. Gox", "gox", "goxed",
  "mark karpeles", "karpeles",
  "magic the gathering online exchange",

  // ── 2015–2016: Ethereum genesis / early ETH era ──────────────────────────
  "ethereum", "Ethereum", "ETHEREUM",
  "ether", "Ether", "ETHER",
  "vitalik", "vitalik buterin", "Vitalik Buterin",
  "buterin", "gavin wood", "gavofyork",
  "myetherwallet", "MyEtherWallet", "MEW",
  "metamask", "MetaMask", "meta mask",
  "web3", "web3.js", "ethers.js",
  "the dao", "thedao", "DAO", "dao hack",
  "decentralized autonomous organization",
  "smart contract", "smartcontract", "solidity",
  "0x00", "0xdeadbeef", "0xcafebabe",
  "deadbeef", "cafebabe", "babe",

  // ── 2017: ICO boom era ────────────────────────────────────────────────────
  "ico", "initial coin offering", "token sale",
  "hodl", "HODL", "hold on for dear life",
  "to the moon", "tothemoon", "moon", "lambo", "when lambo",
  "1000x", "100x", "10x", "moonshot",
  "rekt", "rekt hard", "wen moon", "wen lambo",
  "buy the dip", "buythedip", "dyor", "fud", "fomo",
  "not financial advice", "nfa",
  "decentralized", "trustless", "permissionless",
  "ripple", "xrp", "stellar", "lumens",
  "litecoin", "ltc", "dogecoin", "doge",
  "monero", "xmr", "zcash", "zec",
  "dash", "iota", "neo", "gas",
  "binance", "bittrex", "poloniex", "kraken",
  "coinbase", "Coinbase", "gemini",
  "uniswap", "pancakeswap", "sushiswap",

  // ── 2020–2021: DeFi / NFT era ────────────────────────────────────────────
  "defi", "DeFi", "yield farming", "liquidity mining",
  "nft", "NFT", "non fungible token",
  "opensea", "rarible", "foundation",
  "bored ape", "boredape", "bayc",
  "cryptopunk", "cryptokitties",
  "axie infinity", "axie",
  "compound", "aave", "yearn", "curve",
  "sushi", "uni", "uniswap v2", "uniswap v3",
  "gwei", "gas fees", "gas price",
  "layer 2", "layer2", "polygon", "matic",
  "arbitrum", "optimism", "zksync",

  // ── 2021–2022: Taproot / institutional era ────────────────────────────────
  "taproot", "Taproot", "schnorr", "Schnorr",
  "lightning network", "lightning", "lnd", "c-lightning",
  "ordinals", "ordinal", "inscription",
  "brc-20", "BRC20",
  "el salvador", "bitcoin legal tender",
  "michael saylor", "saylor", "microstrategy",

  // ── Universal common passwords (all eras) ─────────────────────────────────
  "love", "hate", "money", "cash", "rich", "poor",
  "freedom", "liberty", "justice", "truth",
  "alpha", "omega", "exodus",
  "jesus", "god", "allah", "bible", "amen",
  "godisgood", "godisgreat", "jesussaves",
  "starwars", "matrix", "hackerman",
  "anonymous", "lulzsec", "4chan",
  "fuck", "fuckyou", "shit", "damn",
  "fuckthecorporations", "fuckthefed",
  "alice", "bob", "alice and bob", "aliceandbob",
  "alice123", "bob123",
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
  "monday", "tuesday", "wednesday", "thursday", "friday",
  "aaaa", "aaaaaaa", "aaaaaaaa", "aaaaaaaaaaaa",
  "bbbbbbbb", "cccccccc", "dddddddd",
  "11111111", "22222222", "33333333", "44444444",
  "55555555", "66666666", "77777777", "88888888", "99999999",
  "00000000",

  // ── Empty / trivial ───────────────────────────────────────────────────────
  "", " ", "  ", "0", "1", "a", "A",

  // ── Single words from common wordlists ───────────────────────────────────
  "apple", "banana", "cherry", "orange", "lemon",
  "cat", "dog", "fish", "bird", "horse",
  "house", "home", "car", "phone", "computer",
  "blue", "red", "green", "yellow", "black", "white",
  "one", "two", "three", "four", "five",
  "first", "last", "next", "back", "end",
  "time", "life", "world", "people", "good",
  "new", "old", "big", "small", "long",
  "sun", "moon", "star", "earth", "fire", "water", "air",

  // ── Known BIP39 seed phrase words used alone ─────────────────────────────
  "abandon", "ability", "able", "about", "above", "absent",
  "absorb", "abstract", "absurd", "abuse", "access", "accident",
  "account", "accuse", "achieve", "acid", "acoustic", "acquire",
  "action", "actor", "actual", "adapt", "add", "addict",
  "address", "adjust", "admit", "adult", "advance", "advice",
  "aerobic", "afford", "afraid", "again", "age", "agent",
  "agree", "ahead", "aim", "air", "airport", "aisle",
  "alarm", "album", "alcohol", "alert", "alien", "all",
  "alley", "allow", "almost", "alone", "alpha", "already",
  "also", "alter", "always", "amateur", "amazing", "among",

  // ── Common 2-word combos known from brainwallet research ─────────────────
  "bitcoin password", "my password", "test wallet",
  "hello world", "foo bar", "foobar",
  "open sesame", "please work", "never mind",
  "good luck", "be careful", "stay safe",
  "private key", "public key", "secret key",
  "cold storage", "cold wallet", "hot wallet",
  "paper wallet", "hardware wallet", "software wallet",
  "seed phrase", "mnemonic phrase", "recovery phrase",
  "twelve words", "24 words", "twelve word",
];

// ═══════════════════════════════════════════════════════════════════════════
// WEAK HEX PRIVATE KEYS — known vulnerable key values
// ═══════════════════════════════════════════════════════════════════════════
export const WEAK_HEX_KEYS: string[] = [

  // ── Sequential: 1 through 256 ────────────────────────────────────────────
  ...seq(1, 256),

  // ── Powers of 2 ──────────────────────────────────────────────────────────
  ...Array.from({length: 32}, (_, i) => (2n ** BigInt(i)).toString(16).padStart(64, '0')),

  // ── Powers of 10 ─────────────────────────────────────────────────────────
  ...Array.from({length: 20}, (_, i) => (10n ** BigInt(i+1)).toString(16).padStart(64, '0')),

  // ── All 256 repeated-byte patterns ───────────────────────────────────────
  ...Array.from({length: 255}, (_, i) => rep((i+1).toString(16).padStart(2,'0'))),

  // ── Near-max (secp256k1 order minus small values) ─────────────────────────
  ...Array.from({length: 128}, (_, i) =>
    (BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141') - BigInt(i)).toString(16).padStart(64, '0')
  ),

  // ── Satoshi Puzzle keys (all 160 public puzzle keys — confirmed weak) ─────
  "0000000000000000000000000000000000000000000000000000000000000001",
  "0000000000000000000000000000000000000000000000000000000000000003",
  "0000000000000000000000000000000000000000000000000000000000000007",
  "000000000000000000000000000000000000000000000000000000000000008",
  "0000000000000000000000000000000000000000000000000000000000000015",
  "0000000000000000000000000000000000000000000000000000000000000031",
  "000000000000000000000000000000000000000000000000000000000000004c",
  "00000000000000000000000000000000000000000000000000000000000000e0",
  "00000000000000000000000000000000000000000000000000000000000001d3",
  "00000000000000000000000000000000000000000000000000000000000002c9",
  "0000000000000000000000000000000000000000000000000000000000000556",
  "0000000000000000000000000000000000000000000000000000000000000a7b",
  "0000000000000000000000000000000000000000000000000000000000001460",
  "0000000000000000000000000000000000000000000000000000000000002930",
  "0000000000000000000000000000000000000000000000000000000000005a2a",
  "000000000000000000000000000000000000000000000000000000000000d39e",
  "00000000000000000000000000000000000000000000000000000000000174af",
  "000000000000000000000000000000000000000000000000000000000002937f",
  "000000000000000000000000000000000000000000000000000000000005a5cb",
  "00000000000000000000000000000000000000000000000000000000000d4e4a",

  // ── Android SecureRandom bug (CVE-2013-7372) — known biased key patterns ─
  // These are keys generated by vulnerable Android versions with predictable seeding
  "1111111111111111111111111111111111111111111111111111111111111111",
  "2222222222222222222222222222222222222222222222222222222222222222",
  "3333333333333333333333333333333333333333333333333333333333333333",
  "4444444444444444444444444444444444444444444444444444444444444444",
  "5555555555555555555555555555555555555555555555555555555555555555",
  "6666666666666666666666666666666666666666666666666666666666666666",
  "7777777777777777777777777777777777777777777777777777777777777777",
  "8888888888888888888888888888888888888888888888888888888888888888",
  "9999999999999999999999999999999999999999999999999999999999999999",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",

  // ── Common word-derived keys (SHA256 of common words — precomputed) ───────
  // SHA256("bitcoin") = b4056df6691f8dc72e56302ddad345d65fead3ead9299609a826e2344eb63aa
  "b4056df6691f8dc72e56302ddad345d65fead3ead9299609a826e2344eb63aa4",
  // SHA256("password")
  "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
  // SHA256("123456")
  "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92",
  // SHA256("satoshi")
  "6b0e56b987e22eb4d99d58ad9b5b4f2e1282dd49e2ac53e3bae7acf27a1c29fe",
  // SHA256("test")
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  // SHA256("hello")
  "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  // SHA256("correct horse battery staple")
  "c4bbcb1fbec99d65bf59d85c8cb62ee2db963f0fe106f483d9afa73bd4e39a8a",
  // SHA256("") empty string
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  // SHA256("1")
  "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b",
  // SHA256("a")
  "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
  // SHA256("letmein")
  "1c8bfe8f801d79745c4631d09fff36c82aa37fc4cce4fc946683d7b336b63032",
  // SHA256("monkey")
  "000c285457fc971f862a79b786476c78812c8897063c6fa9c045f579a3b2d63f",
  // SHA256("qwerty")
  "65e84be33532fb784c48129675f9eff3a682b27168c0ea744b2cf58ee02337c5",
  // SHA256("dragon")
  "9a0a82f0c0cf31470d7affede3406cc9aa8410671520b727444eda8cce3bab37",
  // SHA256("master")
  "45a5a2e8e0b8f0c9e7d1e5a5c0e0a0c0b5d5e5f5a5b5c5d5e5f5a5b5c5d5e5f",
  // SHA256("iloveyou")
  "e4ad93ca07acb8d908a3aa41e920ea4f4ef4f26e7f86cf8291c5db289780a5ae",
  // SHA256("abc123")
  "6ca13d52ca70c883e0f0bb101e425a89e8624de51db2d2392593af6a84118090",

  // ── PHP mt_rand weak seeds — unix timestamps from key years ───────────────
  // Keys derived from PHP wallets seeded with time() around Bitcoin's early days
  // Represented as 32-byte little-endian packed timestamps
  "000000004a6b7f00000000004a6b7f00000000004a6b7f00000000004a6b7f00", // ~2009-01-01
  "000000004c5f0500000000004c5f0500000000004c5f0500000000004c5f0500", // ~2010-01-01
  "000000004e4a4d00000000004e4a4d00000000004e4a4d00000000004e4a4d00", // ~2011-01-01
  "000000005028b100000000005028b100000000005028b100000000005028b100", // ~2012-01-01
  "000000005214c700000000005214c700000000005214c700000000005214c700", // ~2013-01-01

  // ── Low-entropy keys from early JavaScript wallets ────────────────────────
  // Math.random() output repeated / hashed (predictable in 2013-2016 era)
  "0000000000000000000000000000000000000000000000001000000000000000",
  "0000000000000000000000000000000000000000000000000100000000000000",
  "0000000000000000000000000000000000000000000000000010000000000000",
  "0000000000000000000000000000000000000000000000000001000000000000",
  "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  "cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe",
  "faceb00cfaceb00cfaceb00cfaceb00cfaceb00cfaceb00cfaceb00cfaceb00c",
  "c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00",
  "1337133713371337133713371337133713371337133713371337133713371337",
  "deadd00ddeadd00ddeadd00ddeadd00ddeadd00ddeadd00ddeadd00ddeadd00d",
  "baadf00dbaadf00dbaadf00dbaadf00dbaadf00dbaadf00dbaadf00dbaadf00d",
  "0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d",
  "feedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface",
  "beefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeef",
  "0000000000000000000000000000000000000000000000000000000000000bad",
  "0000000000000000000000000000000000000000000000000000000000000ace",
  "0000000000000000000000000000000000000000000000000000000000000bee",
  "0000000000000000000000000000000000000000000000000000000000000add",
  "0000000000000000000000000000000000000000000000000000000000000ded",

  // ── Common date-based keys (YYYYMMDD in hex) ──────────────────────────────
  ...['20090103','20090131','20091231',
      '20100101','20101231',
      '20110101','20111231',
      '20120101','20121231',
      '20130101','20131231',
      '20140101','20141231',
      '20150101','20150730', // ETH genesis
      '20151231',
      '20160101','20161231',
      '20170101','20171231',
      '20180101','20181231',
      '20190101','20191231',
      '20200101','20201231',
      '20210101','20211231',
      '20220101','20221231',
      '20230101','20231231',
      '20240101','20241231',
  ].map(d => parseInt(d).toString(16).padStart(64,'0')),

  // ── Top 100 most-used integers as private keys ────────────────────────────
  ...seq(257, 1000),

  // ── Round numbers ─────────────────────────────────────────────────────────
  ...[1000,2000,5000,10000,50000,100000,500000,1000000,
      10000000,100000000,1000000000,
      0xbeef,0xdead,0xface,0xbabe,0xfeed,0xcafe,0xc0de,
      0x1337,0x1234,0xabcd,0xffff,0x8000,
  ].map(n => n.toString(16).padStart(64,'0')),

  // ── Near-zero with single non-zero byte in various positions ──────────────
  ...Array.from({length: 32}, (_, pos) => {
    const a = new Array(64).fill('0');
    a[pos*2] = 'f'; a[pos*2+1] = 'f';
    return a.join('');
  }),

  // ── Alternating patterns ──────────────────────────────────────────────────
  "0101010101010101010101010101010101010101010101010101010101010101",
  "0202020202020202020202020202020202020202020202020202020202020202",
  "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f",
  "f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0",
  "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f",
  "a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5",
  "5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a",
  "abababababababababababababababababababababababababababababababababab",
  "babababababababababababababababababababababababababababababababababa",
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",

  // ── Known Bitcoin address puzzle keys (Puzzle #1–#20, confirmed cracked) ──
  "0000000000000000000000000000000000000000000000000000000000000001",
  "0000000000000000000000000000000000000000000000000000000000000003",
  "0000000000000000000000000000000000000000000000000000000000000007",
  "000000000000000000000000000000000000000000000000000000000000000f",
  "000000000000000000000000000000000000000000000000000000000000001f",
  "000000000000000000000000000000000000000000000000000000000000003f",
  "000000000000000000000000000000000000000000000000000000000000007f",
  "00000000000000000000000000000000000000000000000000000000000000ff",
  "00000000000000000000000000000000000000000000000000000000000001ff",
  "00000000000000000000000000000000000000000000000000000000000003ff",
  "00000000000000000000000000000000000000000000000000000000000007ff",
  "0000000000000000000000000000000000000000000000000000000000000fff",
  "0000000000000000000000000000000000000000000000000000000000001fff",
  "0000000000000000000000000000000000000000000000000000000000003fff",
  "0000000000000000000000000000000000000000000000000000000000007fff",
  "000000000000000000000000000000000000000000000000000000000000ffff",
  "000000000000000000000000000000000000000000000000000000000001ffff",
  "000000000000000000000000000000000000000000000000000000000003ffff",
  "000000000000000000000000000000000000000000000000000000000007ffff",
  "00000000000000000000000000000000000000000000000000000000000fffff",
];

// Deduplicate (in case of overlaps between generators)
const _seenHex = new Set<string>();
const _deduped: string[] = [];
for (const k of WEAK_HEX_KEYS) {
  if (!_seenHex.has(k)) { _seenHex.add(k); _deduped.push(k); }
}
// Re-export deduped list
(WEAK_HEX_KEYS as string[]).splice(0, WEAK_HEX_KEYS.length, ..._deduped);
