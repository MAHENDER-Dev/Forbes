// GET /api/person?uri=<forbes-uri>
// On-demand extras for one billionaire: wealth history + bio fields.
// (Live holdings already ship with /api/data.)

const F = require("./_forbes");

module.exports = async (req, res) => {
  const uri = (req.query && req.query.uri) ||
    (new URL(req.url, "http://x").searchParams.get("uri"));
  if (!uri) return res.status(400).json({ error: "missing uri" });

  try {
    const j = await F.fetchJson(
      "https://www.forbes.com/forbesapi/person/" + encodeURIComponent(uri) + ".json"
    );
    const person = j.person;
    if (!person) return res.status(404).json({ error: "not found" });

    const pls = person.personLists || [];

    // Wealth history: one worth ($M) per year, preferring the primary billionaires list.
    const yearMap = {};
    pls.forEach((e) => {
      if (!e.year || e.finalWorth == null) return;
      const primary = /billionaires|real-time|^rtb$/i.test(e.listUri || "");
      const cur = yearMap[e.year];
      if (!cur) yearMap[e.year] = { w: e.finalWorth, p: primary };
      else if (primary && !cur.p) yearMap[e.year] = { w: e.finalWorth, p: primary };
      else if (primary === cur.p && e.finalWorth > cur.w) cur.w = e.finalWorth;
    });
    const wealth = Object.keys(yearMap)
      .map(Number).filter((y) => y > 0).sort((a, b) => a - b)
      .map((y) => ({ year: y, worth: yearMap[y].w }));

    let education = "";
    if (Array.isArray(person.educations)) {
      education = person.educations
        .map((x) => [x.degree, x.school].filter(Boolean).join(", "))
        .filter(Boolean).join(" | ");
    }

    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1200");
    res.status(200).json({
      uri,
      name: person.name || "",
      title: person.title || "",
      organization: person.organization || "",
      quote: person.quote || "",
      wealth,
      marital: person.maritalStatus || null,
      children: person.numberOfChildren != null ? person.numberOfChildren : null,
      education: education || null,
      listAppearances: pls.length,
      residenceCountry: person.countryOfResidence || "",
      residenceState: person.stateProvince || person.residenceStateRegion || "",
      birthCountry: person.birthCountry || "",
      selfMadeType: person.selfMadeType || "",
      finalWorthDate: person.finalWorthDate || null,
    });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
