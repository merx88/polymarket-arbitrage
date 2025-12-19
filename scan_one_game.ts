// scan_one_game.ts
// Usage: npx tsx scan_one_game.ts <poly_event_slug> <kalshi_event_ticker>

export {}; // Make this file a module to avoid global scope conflicts

const POLY_GAMMA = "https://gamma-api.polymarket.com";
const POLY_CLOB = "https://clob.polymarket.com";
const KALSHI_API = "https://api.elections.kalshi.com/trade-api/v2";

function die(msg: string): never {
  console.error("ERROR:", msg);
  process.exit(1);
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function parseJsonArray(s?: string): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

async function fetchJson(url: string) {
  const r = await fetch(url);
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    die(`${r.status} ${r.statusText} for ${url}\n${txt}`);
  }
  return r.json();
}

// ---------- Polymarket ----------
type PolyMarketScan = {
  id: string | number;
  sportsMarketType?: string;
  outcomes?: string;      // JSON string
  clobTokenIds?: string;  // JSON string
  question?: string;
};

type PolyEventScan = {
  slug?: string;
  title?: string;
  eventDate?: string;
  startTime?: string;
  endDate?: string;
  markets?: PolyMarketScan[];
};

async function getPolyEventBySlug(slug: string): Promise<PolyEventScan> {
  return fetchJson(`${POLY_GAMMA}/events/slug/${encodeURIComponent(slug)}`);
}

function pickPolyMoneylineMarket(ev: PolyEventScan): PolyMarketScan {
  const markets = ev.markets ?? [];
  const moneylines = markets.filter((m): m is PolyMarketScan => m.sportsMarketType === "moneyline");
  if (!moneylines.length) die("Polymarket: no sportsMarketType=moneyline market in this event.");

  // 가장 경기명 같은 question 우선
  moneylines.sort((a, b) => {
    const aq = (a.question ?? "").toLowerCase();
    const bq = (b.question ?? "").toLowerCase();
    const aLooks = aq.includes(" vs") || aq.includes("vs.");
    const bLooks = bq.includes(" vs") || bq.includes("vs.");
    return Number(bLooks) - Number(aLooks);
  });

  return moneylines[0];
}

async function polyBestAsk(tokenId: string): Promise<number> {
  // CLOB best ask = side=BUY
  const u = new URL(`${POLY_CLOB}/price`);
  u.searchParams.set("token_id", tokenId);
  u.searchParams.set("side", "SELL");
  const j = await fetchJson(u.toString());
  const p = Number(j.price);
  if (!Number.isFinite(p)) die(`Polymarket: invalid price for token_id=${tokenId}: ${JSON.stringify(j)}`);
  return p;
}

// ---------- Kalshi ----------
type KalshiEventResponse = {
  event: {
    event_ticker: string;
    title?: string;
    sub_title?: string;
    markets?: KalshiMarket[];
  };
  // (구버전 호환) top-level markets가 올 수도 있는데, with_nested_markets=true면 event.markets가 채워짐
  markets?: KalshiMarket[];
};

type KalshiMarket = {
  ticker: string;
  title?: string;
  yes_sub_title?: string;
  yes_ask_dollars?: string;
  yes_bid_dollars?: string;
  no_ask_dollars?: string;
  no_bid_dollars?: string;
};

async function getKalshiEventWithMarkets(eventTicker: string): Promise<KalshiEventResponse> {
  const u = new URL(`${KALSHI_API}/events/${encodeURIComponent(eventTicker)}`);
  u.searchParams.set("with_nested_markets", "true");
  return fetchJson(u.toString());
}
function canonicalizeTeamName(s: string): string {
    // 강한 정규화: 흔한 축약/표기 통일
    return s
      .toLowerCase()
      .replace(/\([^)]*\)/g, "")  // 괄호와 그 안의 내용 제거 (예: "(FL)", "(CA)")
      .replace(/\./g, "")
      .replace(/\bstate\b/g, "st")        // state -> st
      .replace(/\bst\b/g, "st")           // st -> st
      .replace(/\buniversity\b/g, "u")    // university -> u
      .replace(/\bcollege\b/g, "c")       // college -> c (optional)
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }
  
  function buildAliases(polyTeam: string): string[] {
    // Polymarket 팀명을 기반으로 Kalshi에 나올 법한 표기들을 생성
    const base = polyTeam.trim();
    const noDots = base.replace(/\./g, "");
    const variants = new Set<string>();
  
    variants.add(base);
    variants.add(noDots);
  
    // NFL 팀명 매핑 (같은 이벤트 가정)
    const nflMappings: Record<string, string[]> = {
      // NFC East
      "Giants": ["New York Giants", "NY Giants", "New York"],
      "Eagles": ["Philadelphia", "Philadelphia Eagles"],
      "Cowboys": ["Dallas", "Dallas Cowboys"],
      "Commanders": ["Washington", "Washington Commanders", "Redskins"],
      
      // NFC North
      "Packers": ["Green Bay", "Green Bay Packers"],
      "Bears": ["Chicago", "Chicago Bears"],
      "Lions": ["Detroit", "Detroit Lions"],
      "Vikings": ["Minnesota", "Minnesota Vikings"],
      
      // NFC South
      "Buccaneers": ["Tampa Bay", "Tampa", "Tampa Bay Buccaneers"],
      "Saints": ["New Orleans", "New Orleans Saints"],
      "Falcons": ["Atlanta", "Atlanta Falcons"],
      "Panthers": ["Carolina", "Carolina Panthers"],
      
      // NFC West
      "49ers": ["San Francisco", "San Francisco 49ers"],
      "Seahawks": ["Seattle", "Seattle Seahawks"],
      "Rams": ["Los Angeles", "LA Rams", "Los Angeles Rams"],
      "Cardinals": ["Arizona", "Arizona Cardinals"],
      
      // AFC East
      "Patriots": ["New England", "New England Patriots"],
      "Dolphins": ["Miami", "Miami Dolphins"],
      "Bills": ["Buffalo", "Buffalo Bills"],
      "Jets": ["New York Jets", "NY Jets"],
      
      // AFC North
      "Steelers": ["Pittsburgh", "Pittsburgh Steelers"],
      "Ravens": ["Baltimore", "Baltimore Ravens"],
      "Browns": ["Cleveland", "Cleveland Browns"],
      "Bengals": ["Cincinnati", "Cincinnati Bengals"],
      
      // AFC South
      "Titans": ["Tennessee", "Tennessee Titans"],
      "Colts": ["Indianapolis", "Indianapolis Colts"],
      "Jaguars": ["Jacksonville", "Jacksonville Jaguars"],
      "Texans": ["Houston", "Houston Texans"],
      
      // AFC West
      "Chiefs": ["Kansas City", "Kansas City Chiefs"],
      "Raiders": ["Las Vegas", "Oakland", "Las Vegas Raiders", "Oakland Raiders"],
      "Chargers": ["Los Angeles Chargers", "LA Chargers", "San Diego Chargers"],
      "Broncos": ["Denver", "Denver Broncos"],
    };
  
    // NFL 매핑이 있으면 추가
    if (nflMappings[base]) {
      nflMappings[base].forEach(v => variants.add(v));
    }
  
    // State <-> St.
    variants.add(base.replace(/\bState\b/g, "St."));
    variants.add(base.replace(/\bState\b/g, "St"));
    variants.add(base.replace(/\bState\b/g, "st."));
    variants.add(base.replace(/\bState\b/g, "st"));
  
    // St. <-> State
    variants.add(base.replace(/\bSt\.?\b/g, "State"));
  
    // University <-> U
    variants.add(base.replace(/\bUniversity\b/g, "U"));
    variants.add(base.replace(/\bUniv\.?\b/g, "U"));
    variants.add(base.replace(/\bU\b/g, "University"));
  
    // 정규화된 키도 넣기
    variants.add(canonicalizeTeamName(base));
  
    return Array.from(variants);
  }
  
  function getKalshiAskByTeam(ev: KalshiEventResponse, polyTeams: string[]): {
    yes: Record<string, number>;
    no: Record<string, number>;
  } {
    const markets = ev.event?.markets?.length ? ev.event.markets : (ev.markets ?? []);
    if (!markets.length) die("Kalshi: no markets found in event response.");
  
    const yesOut: Record<string, number> = {};
    const noOut: Record<string, number> = {};
  
    // 같은 이벤트이므로 모든 markets를 확인하고 더 관대한 매칭 시도
    for (const m of markets) {
      const ys = (m.yes_sub_title ?? "").trim();
      if (!ys) continue;
  
      const yesAsk = Number(m.yes_ask_dollars);
      const noAsk = Number(m.no_ask_dollars);
      
      if (!Number.isFinite(yesAsk) && !Number.isFinite(noAsk)) continue;
  
      // 각 Polymarket 팀과 매칭 시도
      for (const polyTeam of polyTeams) {
        // buildAliases로 생성된 모든 변형과 매칭 시도
        const aliases = buildAliases(polyTeam);
        const marketNorm = canonicalizeTeamName(ys);
        
        // 정규화된 alias와 매칭
        const isMatch = aliases.some(alias => {
          const aliasNorm = canonicalizeTeamName(alias);
          return marketNorm === aliasNorm || 
                 marketNorm.includes(aliasNorm) || 
                 aliasNorm.includes(marketNorm);
        });
  
        // 추가: 단어 단위 매칭 (예: "Packers"와 "Green Bay"에서 공통 단어 찾기)
        const polyWords = canonicalizeTeamName(polyTeam).split(/\s+/).filter(w => w.length > 2);
        const marketWords = marketNorm.split(/\s+/).filter(w => w.length > 2);
        const wordMatch = polyWords.some(pw => marketWords.includes(pw)) || 
                         marketWords.some(mw => polyWords.includes(mw));
  
        if (isMatch || wordMatch) {
          if (Number.isFinite(yesAsk)) {
            yesOut[polyTeam] = yesOut[polyTeam] === undefined ? yesAsk : Math.min(yesOut[polyTeam], yesAsk);
          }
          if (Number.isFinite(noAsk)) {
            noOut[polyTeam] = noOut[polyTeam] === undefined ? noAsk : Math.min(noOut[polyTeam], noAsk);
          }
          break; // 매칭되면 다음 market으로
        }
      }
    }
  
    // 매칭 실패 시 디버깅 정보 출력
    const unmatchedTeams = polyTeams.filter(t => yesOut[t] === undefined && noOut[t] === undefined);
    if (unmatchedTeams.length > 0) {
      console.error("\n⚠️  Warning: Could not match some teams in Kalshi markets:");
      console.error(`   Unmatched teams: ${unmatchedTeams.join(", ")}`);
      console.error(`   Available Kalshi markets:`);
      markets.forEach((m, idx) => {
        console.error(`     ${idx + 1}. yes_sub_title: "${m.yes_sub_title}" (YES: ${m.yes_ask_dollars}, NO: ${m.no_ask_dollars})`);
      });
      console.error("");
    }
  
    return { yes: yesOut, no: noOut };
  }

// ---------- Fee calculation ----------
function calculateKalshiFee(price: number, contracts: number = 1): number {
  // Fee = RoundUpToCent(0.07 × C × P × (1 − P))
  const fee = 0.07 * contracts * price * (1 - price);
  // 센트 단위 올림
  return Math.ceil(fee * 100) / 100;
}

// ---------- Cross-platform set ----------
async function main() {
  const polySlug = process.argv[2];
  const kalshiEventTicker = process.argv[3].toUpperCase();

  if (!polySlug || !kalshiEventTicker) {
    die("Usage: npx tsx scan_one_game.ts <poly_event_slug> <kalshi_event_ticker>");
  }

  // 1) Polymarket: 이벤트 -> moneyline -> (팀, token_id) 2개
  const polyEv = await getPolyEventBySlug(polySlug);
  const polyML = pickPolyMoneylineMarket(polyEv);

  const outcomesStr = typeof polyML.outcomes === 'string' ? polyML.outcomes : undefined;
  const tokenIdsStr = typeof polyML.clobTokenIds === 'string' ? polyML.clobTokenIds : undefined;
  const teams = parseJsonArray(outcomesStr);
  const tokenIds = parseJsonArray(tokenIdsStr);

  if (teams.length !== 2 || tokenIds.length !== 2) {
    die(`Polymarket: moneyline market does not have 2 outcomes/tokenIds. marketId=${polyML.id}`);
  }

  const teamA = teams[0];
  const teamB = teams[1];
  const polyToken: Record<string, string> = {
    [teamA]: tokenIds[0],
    [teamB]: tokenIds[1],
  };

  // 2) Polymarket team별 best ask (YES와 NO 모두)
  // Team A NO = Team B YES (Team A가 지는 것 = Team B가 이기는 것)
  // Team B NO = Team A YES (Team B가 지는 것 = Team A가 이기는 것)
  const [polyYesA, polyYesB, polyNoA, polyNoB] = await Promise.all([
    polyBestAsk(polyToken[teamA]),      // Team A YES
    polyBestAsk(polyToken[teamB]),      // Team B YES
    polyBestAsk(polyToken[teamB]),      // Team A NO = Team B YES 토큰
    polyBestAsk(polyToken[teamA]),      // Team B NO = Team A YES 토큰
  ]);

  // 3) Kalshi: 이벤트 하나 -> 내부 markets -> 팀별 yes/no ask
  const kalshiEv = await getKalshiEventWithMarkets(kalshiEventTicker);
  const kalshiPrices = getKalshiAskByTeam(kalshiEv, [teamA, teamB]);
  const kalshiYes = kalshiPrices.yes;
  const kalshiNo = kalshiPrices.no;

  // 4) 모든 가능한 조합 비교 (YES/NO 조합 + 플랫폼 조합)
  type Combination = {
    name: string;
    teamA: { venue: string; type: "YES" | "NO"; ask: number; tokenId?: string; fee?: number };
    teamB: { venue: string; type: "YES" | "NO"; ask: number; tokenId?: string; fee?: number };
    totalCost: number;
    totalCostWithFees: number;
  };

  const combinations: Combination[] = [];

  // Team A YES + Team B YES 조합
  if (polyYesA !== undefined && polyYesB !== undefined) {
    combinations.push({
      name: "Polymarket YES + Polymarket YES",
      teamA: { venue: "Polymarket", type: "YES", ask: polyYesA, tokenId: polyToken[teamA] },
      teamB: { venue: "Polymarket", type: "YES", ask: polyYesB, tokenId: polyToken[teamB] },
      totalCost: polyYesA + polyYesB,
      totalCostWithFees: polyYesA + polyYesB, // Polymarket 수수료는 별도 계산 필요
    });
  }
  if (kalshiYes[teamA] !== undefined && kalshiYes[teamB] !== undefined) {
    const feeA = calculateKalshiFee(kalshiYes[teamA]);
    const feeB = calculateKalshiFee(kalshiYes[teamB]);
    combinations.push({
      name: "Kalshi YES + Kalshi YES",
      teamA: { venue: "Kalshi", type: "YES", ask: kalshiYes[teamA], fee: feeA },
      teamB: { venue: "Kalshi", type: "YES", ask: kalshiYes[teamB], fee: feeB },
      totalCost: kalshiYes[teamA] + kalshiYes[teamB],
      totalCostWithFees: kalshiYes[teamA] + feeA + kalshiYes[teamB] + feeB,
    });
  }
  if (polyYesA !== undefined && kalshiYes[teamB] !== undefined) {
    const feeB = calculateKalshiFee(kalshiYes[teamB]);
    combinations.push({
      name: "Polymarket YES + Kalshi YES",
      teamA: { venue: "Polymarket", type: "YES", ask: polyYesA, tokenId: polyToken[teamA] },
      teamB: { venue: "Kalshi", type: "YES", ask: kalshiYes[teamB], fee: feeB },
      totalCost: polyYesA + kalshiYes[teamB],
      totalCostWithFees: polyYesA + kalshiYes[teamB] + feeB,
    });
  }
  if (kalshiYes[teamA] !== undefined && polyYesB !== undefined) {
    const feeA = calculateKalshiFee(kalshiYes[teamA]);
    combinations.push({
      name: "Kalshi YES + Polymarket YES",
      teamA: { venue: "Kalshi", type: "YES", ask: kalshiYes[teamA], fee: feeA },
      teamB: { venue: "Polymarket", type: "YES", ask: polyYesB, tokenId: polyToken[teamB] },
      totalCost: kalshiYes[teamA] + polyYesB,
      totalCostWithFees: kalshiYes[teamA] + feeA + polyYesB,
    });
  }

  // Team A YES + Team B NO 조합 제외 (같은 결과에 베팅: 둘 다 Team A 승리)
  // Team A NO + Team B YES 조합 제외 (같은 결과에 베팅: 둘 다 Team B 승리)
  // 양방향 베팅만 유효: Team A YES + Team B YES 또는 Team A NO + Team B NO

  // Team A NO + Team B NO 조합
  if (polyNoA !== undefined && polyNoB !== undefined) {
    combinations.push({
      name: "Polymarket NO + Polymarket NO",
      teamA: { venue: "Polymarket", type: "NO", ask: polyNoA, tokenId: polyToken[teamA] },
      teamB: { venue: "Polymarket", type: "NO", ask: polyNoB, tokenId: polyToken[teamB] },
      totalCost: polyNoA + polyNoB,
      totalCostWithFees: polyNoA + polyNoB, // Polymarket 수수료는 별도 계산 필요
    });
  }
  if (kalshiNo[teamA] !== undefined && kalshiNo[teamB] !== undefined) {
    const feeA = calculateKalshiFee(kalshiNo[teamA]);
    const feeB = calculateKalshiFee(kalshiNo[teamB]);
    combinations.push({
      name: "Kalshi NO + Kalshi NO",
      teamA: { venue: "Kalshi", type: "NO", ask: kalshiNo[teamA], fee: feeA },
      teamB: { venue: "Kalshi", type: "NO", ask: kalshiNo[teamB], fee: feeB },
      totalCost: kalshiNo[teamA] + kalshiNo[teamB],
      totalCostWithFees: kalshiNo[teamA] + feeA + kalshiNo[teamB] + feeB,
    });
  }
  if (polyNoA !== undefined && kalshiNo[teamB] !== undefined) {
    const feeB = calculateKalshiFee(kalshiNo[teamB]);
    combinations.push({
      name: "Polymarket NO + Kalshi NO",
      teamA: { venue: "Polymarket", type: "NO", ask: polyNoA, tokenId: polyToken[teamA] },
      teamB: { venue: "Kalshi", type: "NO", ask: kalshiNo[teamB], fee: feeB },
      totalCost: polyNoA + kalshiNo[teamB],
      totalCostWithFees: polyNoA + kalshiNo[teamB] + feeB,
    });
  }
  if (kalshiNo[teamA] !== undefined && polyNoB !== undefined) {
    const feeA = calculateKalshiFee(kalshiNo[teamA]);
    combinations.push({
      name: "Kalshi NO + Polymarket NO",
      teamA: { venue: "Kalshi", type: "NO", ask: kalshiNo[teamA], fee: feeA },
      teamB: { venue: "Polymarket", type: "NO", ask: polyNoB, tokenId: polyToken[teamB] },
      totalCost: kalshiNo[teamA] + polyNoB,
      totalCostWithFees: kalshiNo[teamA] + feeA + polyNoB,
    });
  }

  if (combinations.length === 0) {
    die("No valid combinations found. Check if prices are available for both teams.");
  }

  // 크로스 마켓 조합만 필터링 (서로 다른 플랫폼에서 구매)
  const crossMarketCombinations = combinations.filter(
    (combo) => combo.teamA.venue !== combo.teamB.venue
  );

  if (crossMarketCombinations.length === 0) {
    console.log("No cross-market arbitrage opportunities found.");
    console.log("All combinations use the same platform for both teams.");
    return;
  }

  // 가장 저렴한 조합 선택 (수수료 포함)
  const bestCombination = crossMarketCombinations.reduce((best, current) =>
    current.totalCostWithFees < best.totalCostWithFees ? current : best
  );

  const setCost = bestCombination.totalCost;
  const setCostWithFees = bestCombination.totalCostWithFees;
  const edge = 1 - setCost;
  const edgeAfterFees = 1 - setCostWithFees;

  console.log("=== Cross-platform arbitrage opportunities ===");
  console.log(`Polymarket event: ${polyEv.title ?? polySlug}`);
  console.log(`Kalshi event:     ${kalshiEv.event?.title ?? kalshiEventTicker}`);
  console.log("");

  console.log(`[Team A] ${teamA}`);
  console.log(`  Polymarket YES: ${polyYesA.toFixed(4)} (token_id=${polyToken[teamA]})`);
  console.log(`  Polymarket NO:  ${polyNoA.toFixed(4)} (token_id=${polyToken[teamB]})`);
  if (kalshiYes[teamA] !== undefined) {
    console.log(`  Kalshi YES:     ${kalshiYes[teamA].toFixed(4)}`);
  }
  if (kalshiNo[teamA] !== undefined) {
    console.log(`  Kalshi NO:      ${kalshiNo[teamA].toFixed(4)}`);
  }
  console.log("");

  console.log(`[Team B] ${teamB}`);
  console.log(`  Polymarket YES: ${polyYesB.toFixed(4)} (token_id=${polyToken[teamB]})`);
  console.log(`  Polymarket NO:  ${polyNoB.toFixed(4)} (token_id=${polyToken[teamA]})`);
  if (kalshiYes[teamB] !== undefined) {
    console.log(`  Kalshi YES:     ${kalshiYes[teamB].toFixed(4)}`);
  }
  if (kalshiNo[teamB] !== undefined) {
    console.log(`  Kalshi NO:      ${kalshiNo[teamB].toFixed(4)}`);
  }
  console.log("");

  console.log("=== Cross-market combinations only ===");
  crossMarketCombinations
    .sort((a, b) => a.totalCostWithFees - b.totalCostWithFees)
    .forEach((combo, idx) => {
      const isBest = combo === bestCombination;
      const marker = isBest ? "⭐ BEST" : "";
      const edge = 1 - combo.totalCost;
      const edgeAfterFees = 1 - combo.totalCostWithFees;
      console.log(
        `${idx + 1}. ${combo.name} ${marker}`
      );
      console.log(`   Team A: ${combo.teamA.venue} ${combo.teamA.type} @ ${combo.teamA.ask.toFixed(4)}${combo.teamA.fee !== undefined ? ` (fee: $${combo.teamA.fee.toFixed(2)})` : ""}`);
      console.log(`   Team B: ${combo.teamB.venue} ${combo.teamB.type} @ ${combo.teamB.ask.toFixed(4)}${combo.teamB.fee !== undefined ? ` (fee: $${combo.teamB.fee.toFixed(2)})` : ""}`);
      console.log(`   Total (pre-fee):  ${combo.totalCost.toFixed(4)} (Edge: ${edge.toFixed(4)} ${edge > 0 ? "✅" : "❌"})`);
      console.log(`   Total (with fees): ${combo.totalCostWithFees.toFixed(4)} (Edge: ${edgeAfterFees.toFixed(4)} ${edgeAfterFees > 0 ? "✅" : "❌"})`);
      console.log("");
    });

  console.log(`=== Best combination ===`);
  console.log(`Strategy: ${bestCombination.name}`);
  console.log(`  Team A: ${bestCombination.teamA.venue} ${bestCombination.teamA.type} @ ${bestCombination.teamA.ask.toFixed(4)}`);
  if (bestCombination.teamA.fee !== undefined) {
    console.log(`    Kalshi fee (1 contract): $${bestCombination.teamA.fee.toFixed(4)}`);
  }
  if (bestCombination.teamA.tokenId) {
    console.log(`    Token ID: ${bestCombination.teamA.tokenId}`);
  }
  console.log(`  Team B: ${bestCombination.teamB.venue} ${bestCombination.teamB.type} @ ${bestCombination.teamB.ask.toFixed(4)}`);
  if (bestCombination.teamB.fee !== undefined) {
    console.log(`    Kalshi fee (1 contract): $${bestCombination.teamB.fee.toFixed(4)}`);
  }
  if (bestCombination.teamB.tokenId) {
    console.log(`    Token ID: ${bestCombination.teamB.tokenId}`);
  }
  console.log(`Set cost (pre-fee):  ${setCost.toFixed(4)}`);
  console.log(`Set cost (with fees): ${setCostWithFees.toFixed(4)}`);
  console.log(`Edge (pre-fee):      ${edge.toFixed(4)} ${edge > 0 ? "✅" : "❌"}`);
  console.log(`Edge (after fees):    ${edgeAfterFees.toFixed(4)} ${edgeAfterFees > 0 ? "✅ (arbitrage opportunity)" : "❌"}`);

  console.log("\nNOTE:");
  console.log("- This is PRE-fee and assumes contracts are economically equivalent.");
  console.log("- Sports cancellation/postponement rules can differ across platforms; verify before trading.");
  console.log("- NO positions mean betting against that team winning.");
}

main().catch((e) => die(String(e)));