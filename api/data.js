// GET /api/data
// Returns the COMPLETE billionaire list, ranked by CURRENT (live) net worth.
// Edge-cached so Forbes is hit at most ~once/3 min regardless of traffic.

const F = require("./_forbes");

module.exports = async (req, res) => {
  try {
    const [annual, rtb] = await Promise.all([
      F.fetchAnnual(),
      F.fetchList(
        "https://www.forbes.com/forbesapi/person/rtb/0/-estWorthPrev/true.json?fields=" + F.RTB_FIELDS
      ).catch(() => []),
    ]);

    if (!annual.length && !rtb.length) {
      return res.status(502).json({ error: "Both Forbes endpoints returned nothing." });
    }

    // Live net worth overlay, merged by uri.
    const liveByUri = {};
    rtb.forEach((p) => { if (p.uri) liveByUri[p.uri] = p; });

    const byUri = {}, order = [];
    const base = annual.length ? annual : rtb;
    base.forEach((p) => { if (p.uri && !byUri[p.uri]) { byUri[p.uri] = p; order.push(p.uri); } });
    if (annual.length) rtb.forEach((p) => { if (p.uri && !byUri[p.uri]) { byUri[p.uri] = p; order.push(p.uri); } });

    let people = order.map((uri) => {
      const p = byUri[uri];
      const live = liveByUri[uri] || {};
      const worth = live.finalWorth || p.finalWorth || 0;          // $M
      const prev = live.estWorthPrev || p.estWorthPrev || null;    // $M
      const changePct = (worth && prev) ? ((worth - prev) / prev) * 100 : null;
      const changeAbs = (worth && prev) ? (worth - prev) : null;   // $M
      return {
        uri,
        forbesRank: p.rank || null,
        name: p.personName || "",
        worth, prev, changeAbs, changePct,
        image: F.buildImage(p.squareImage),
        industries: p.industries || [],
        source: p.source || "",
        country: p.countryOfCitizenship || "",
        city: p.city || "",
        age: F.ageOf(p.birthDate),
        dob: F.dobOf(p.birthDate),
        gender: F.genderOf(p.gender),
        selfMade: p.selfMade,
        selfMadeRank: p.selfMadeRank != null ? p.selfMadeRank : null,
        philanthropy: p.philanthropyScore != null ? p.philanthropyScore : null,
        companies: F.holdingsOf(live.financialAssets, 25),   // live public holdings ($M)
      };
    });

    // Rank by live worth (this is what makes Bezos land at #2, etc.).
    people.sort((a, b) => (b.worth - a.worth) || ((a.forbesRank || 9e9) - (b.forbesRank || 9e9)));
    people.forEach((p, i) => { p.rank = i + 1; });

    res.setHeader("Cache-Control", "s-maxage=180, stale-while-revalidate=600");
    res.status(200).json({
      updatedAt: new Date().toISOString(),
      count: people.length,
      people,
    });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
