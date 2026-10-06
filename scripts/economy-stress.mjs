// Planning model only. Integer milli-IMD, hypothetical price/depth/cost inputs, no market forecast.
export function stress({ days = 90, imd = 3000_000, feeDcp = 0, priceMilliImd = 1, depthDcp = 1e6,
  dailyEssential = 40_000, costMultiplier = 1, reserveDcp = 700e6, playerClaimsDcp = 7000 } = {}) {
  let treasury = imd, accumulatedDcp = 0, operationalSpend = 0, contentSpend = 0, converted = 0, prizes = 0;
  let dormantAt = null, failedConversions = 0;
  const essentialFloor = 500_000;
  for (let day = 0; day < days; day++) {
    accumulatedDcp += feeDcp;
    // Batch dust, <=1% of assumed executable depth, minimum output, hard 1m DCP call cap.
    const amount = Math.min(accumulatedDcp, 1e6);
    if (treasury < 5000_000 && amount >= 10000) {
      if (amount > depthDcp / 100 || priceMilliImd <= 0) failedConversions++;
      else {
        const out = Math.floor(amount * priceMilliImd * 0.97);
        treasury += out; converted += out; accumulatedDcp -= amount;
      }
    }
    const essential = Math.ceil(dailyEssential * costMultiplier);
    if (treasury < essentialFloor + essential) { dormantAt ??= day; continue; }
    treasury -= essential; operationalSpend += essential;
    const runwayDays = treasury / (essential + 500);
    if (runwayDays >= 21 && treasury - 500 >= essentialFloor && (runwayDays >= 60 || day % 3 === 0)) {
      treasury -= 500; contentSpend += 500;
    }
    if (runwayDays >= 21) {
      const emission = Math.min(20000, Math.floor((reserveDcp - playerClaimsDcp) / 1000));
      reserveDcp -= emission; prizes += emission;
    }
  }
  return { days, treasuryMilliImd: treasury, operationalSpendMilliImd: operationalSpend,
    contentSpendMilliImd: contentSpend, convertedMilliImd: converted, accumulatedDcp,
    failedConversions, dormantAtDay: dormantAt, reserveDcp, immutablePlayerClaimsDcp: playerClaimsDcp, prizesDcp: prizes,
    conservation: imd + converted === treasury + operationalSpend + contentSpend };
}
export const scenarios = {
  zeroVolume: {},
  shallowLiquidity: { feeDcp: 20000, depthDcp: 1000 },
  priceFall90Percent: { feeDcp: 20000, priceMilliImd: 0.1, depthDcp: 1e8 },
  risingCosts4x: { costMultiplier: 4 },
  depletedReserve: { reserveDcp: 7000 },
  unfundedBootstrap: { imd: 0 },
};
