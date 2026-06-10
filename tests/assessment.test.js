jest.mock("../src/db", () => ({
  pool: { execute: jest.fn() },
}));

const { pool } = require("../src/db");
const A = require("../src/services/assessment");

const DEFAULT_CONFIG = {
  quarterly_case_target: "8",
  standard_cycle_days: "60",
  weight_case_count: "0.3",
  weight_quality: "0.3",
  weight_efficiency: "0.2",
  weight_attitude: "0.2",
  excellent_threshold: "85",
  good_threshold: "70",
  pass_threshold: "60",
  default_satisfaction: "3",
};

function makeMock(opts) {
  const o = opts || {};
  const cfg = Object.assign({}, DEFAULT_CONFIG, o.config || {});
  pool.execute.mockImplementation(async (sql, params) => {
    if (/FROM\s+assessment_config/i.test(sql)) {
      const key = params[0];
      if (cfg[key] != null) return [[{ config_value: cfg[key] }]];
      return [[]];
    }
    if (/AVG\(satisfaction_score\)/i.test(sql)) {
      return [[{
        avgSatisfaction: o.avgSatisfaction != null ? o.avgSatisfaction : null,
        ratedCount: o.ratedSatisfactionCount != null ? o.ratedSatisfactionCount : 0,
      }]];
    }
    if (/TIMESTAMPDIFF/i.test(sql)) {
      return [[{
        caseCount: o.efficiencyCaseCount != null ? o.efficiencyCaseCount
          : (o.caseCount != null ? o.caseCount : 0),
        avgCycle: o.avgCycle != null ? o.avgCycle : null,
      }]];
    }
    if (/as\s+caseCount\s+FROM\s+cases/i.test(sql)) {
      return [[{
        caseCount: o.qualityCaseCount != null ? o.qualityCaseCount
          : (o.caseCount != null ? o.caseCount : 0),
      }]];
    }
    if (/as\s+count\s+FROM\s+cases/i.test(sql)) {
      return [[{ count: o.caseCount != null ? o.caseCount : 0 }]];
    }
    if (/FROM\s+complaints/i.test(sql)) {
      return [[{ complaintCount: o.complaintCount != null ? o.complaintCount : 0 }]];
    }
    if (/AVG\(rating\)/i.test(sql)) {
      return [[{
        avgRating: o.avgRating != null ? o.avgRating : null,
        ratedCount: o.ratedRatingCount != null ? o.ratedRatingCount : 0,
      }]];
    }
    if (/as\s+consultCount\s+FROM\s+consultations/i.test(sql)) {
      return [[{ consultCount: o.consultCount != null ? o.consultCount : 0 }]];
    }
    return [[]];
  });
}

beforeEach(() => {
  pool.execute.mockReset();
});

describe("getQuarterRange (local time)", () => {
  test("Q1 range", () => {
    const r = A.getQuarterRange(2024, 1);
    expect(r.startDate.getFullYear()).toBe(2024);
    expect(r.startDate.getMonth()).toBe(0);
    expect(r.startDate.getDate()).toBe(1);
    expect(r.startDate.getHours()).toBe(0);
    expect(r.startDate.getMinutes()).toBe(0);
    expect(r.startDate.getSeconds()).toBe(0);
    expect(r.endDate.getFullYear()).toBe(2024);
    expect(r.endDate.getMonth()).toBe(2);
    expect(r.endDate.getDate()).toBe(31);
    expect(r.endDate.getHours()).toBe(23);
    expect(r.endDate.getMinutes()).toBe(59);
    expect(r.endDate.getSeconds()).toBe(59);
  });

  test("Q2 range", () => {
    const r = A.getQuarterRange(2024, 2);
    expect(r.startDate.getMonth()).toBe(3);
    expect(r.startDate.getDate()).toBe(1);
    expect(r.endDate.getMonth()).toBe(5);
    expect(r.endDate.getDate()).toBe(30);
  });

  test("Q3 range", () => {
    const r = A.getQuarterRange(2024, 3);
    expect(r.startDate.getMonth()).toBe(6);
    expect(r.startDate.getDate()).toBe(1);
    expect(r.endDate.getMonth()).toBe(8);
    expect(r.endDate.getDate()).toBe(30);
  });

  test("Q4 range", () => {
    const r = A.getQuarterRange(2024, 4);
    expect(r.startDate.getMonth()).toBe(9);
    expect(r.startDate.getDate()).toBe(1);
    expect(r.endDate.getMonth()).toBe(11);
    expect(r.endDate.getDate()).toBe(31);
    expect(r.endDate.getHours()).toBe(23);
  });
});

describe("getConfig", () => {
  test("hit config returns value from db", async () => {
    makeMock({ config: { quarterly_case_target: "12" } });
    const v = await A.getConfig("quarterly_case_target", "8");
    expect(v).toBe("12");
  });

  test("miss config returns default", async () => {
    pool.execute.mockResolvedValue([[]]);
    const v = await A.getConfig("not_exist_key", "fallback");
    expect(v).toBe("fallback");
  });
});

describe("calcCaseCountScore (case count)", () => {
  test("zero closed cases -> score 0", async () => {
    makeMock({ caseCount: 0 });
    const r = await A.calcCaseCountScore(1, 2024, 1);
    expect(r.count).toBe(0);
    expect(r.score).toBe(0);
    expect(r.target).toBe(8);
  });

  test("half target -> 50", async () => {
    makeMock({ caseCount: 4 });
    const r = await A.calcCaseCountScore(1, 2024, 1);
    expect(r.score).toBe(50);
  });

  test("exactly target -> 100", async () => {
    makeMock({ caseCount: 8 });
    const r = await A.calcCaseCountScore(1, 2024, 1);
    expect(r.score).toBe(100);
  });

  test("over target -> capped at 100", async () => {
    makeMock({ caseCount: 20 });
    const r = await A.calcCaseCountScore(1, 2024, 1);
    expect(r.score).toBe(100);
  });
});

describe("calcQualityScore (quality)", () => {
  test("no closed case -> default satisfaction, 60 floor", async () => {
    makeMock({ qualityCaseCount: 0 });
    const r = await A.calcQualityScore(1, 2024, 1);
    expect(r.satisfaction).toBe(3);
    expect(r.complaintCount).toBe(0);
    expect(r.score).toBe(60);
  });

  test("closed cases but none rated -> use default satisfaction", async () => {
    makeMock({
      qualityCaseCount: 5,
      avgSatisfaction: null,
      ratedSatisfactionCount: 0,
      complaintCount: 0,
    });
    const r = await A.calcQualityScore(1, 2024, 1);
    expect(r.satisfaction).toBe(3);
    expect(r.score).toBe(60);
  });

  test("rated and no complaints -> proportional", async () => {
    makeMock({
      qualityCaseCount: 5,
      avgSatisfaction: 4.5,
      ratedSatisfactionCount: 5,
      complaintCount: 0,
    });
    const r = await A.calcQualityScore(1, 2024, 1);
    expect(r.satisfaction).toBe(4.5);
    expect(r.score).toBe(90);
  });

  test("complaints deduct 20 each", async () => {
    makeMock({
      qualityCaseCount: 5,
      avgSatisfaction: 5,
      ratedSatisfactionCount: 5,
      complaintCount: 2,
    });
    const r = await A.calcQualityScore(1, 2024, 1);
    expect(r.score).toBe(60);
    expect(r.complaintCount).toBe(2);
  });

  test("complaint deduction capped at 100", async () => {
    makeMock({
      qualityCaseCount: 5,
      avgSatisfaction: 5,
      ratedSatisfactionCount: 5,
      complaintCount: 10,
    });
    const r = await A.calcQualityScore(1, 2024, 1);
    expect(r.score).toBe(0);
  });

  test("score lower bound 0", async () => {
    makeMock({
      qualityCaseCount: 5,
      avgSatisfaction: 2,
      ratedSatisfactionCount: 5,
      complaintCount: 3,
    });
    const r = await A.calcQualityScore(1, 2024, 1);
    expect(r.score).toBe(0);
  });
});

describe("calcEfficiencyScore (efficiency)", () => {
  test("no closed case -> 60 floor", async () => {
    makeMock({ efficiencyCaseCount: 0 });
    const r = await A.calcEfficiencyScore(1, 2024, 1);
    expect(r.score).toBe(60);
    expect(r.caseCount).toBe(0);
    expect(r.standardDays).toBe(60);
  });

  test("avgCycle == standard -> 100", async () => {
    makeMock({ efficiencyCaseCount: 3, avgCycle: 60 });
    const r = await A.calcEfficiencyScore(1, 2024, 1);
    expect(r.score).toBe(100);
  });

  test("avgCycle 2x standard -> 50", async () => {
    makeMock({ efficiencyCaseCount: 3, avgCycle: 120 });
    const r = await A.calcEfficiencyScore(1, 2024, 1);
    expect(r.score).toBe(50);
  });

  test("avgCycle < standard -> capped at 100", async () => {
    makeMock({ efficiencyCaseCount: 3, avgCycle: 30 });
    const r = await A.calcEfficiencyScore(1, 2024, 1);
    expect(r.score).toBe(100);
  });

  test("avgCycle null -> falls back to standardDays, 100", async () => {
    makeMock({ efficiencyCaseCount: 3, avgCycle: null });
    const r = await A.calcEfficiencyScore(1, 2024, 1);
    expect(r.score).toBe(100);
  });
});

describe("calcAttitudeScore (attitude)", () => {
  test("no consult and no rating -> 30", async () => {
    makeMock({ consultCount: 0, ratedRatingCount: 0, avgRating: null });
    const r = await A.calcAttitudeScore(1, 2024, 1);
    expect(r.consultationCount).toBe(0);
    expect(r.avgRating).toBe(3);
    expect(r.score).toBe(30);
  });

  test("20 consults + avg 4 -> 90", async () => {
    makeMock({ consultCount: 20, avgRating: 4, ratedRatingCount: 20 });
    const r = await A.calcAttitudeScore(1, 2024, 1);
    expect(r.score).toBe(90);
  });

  test("more than 20 consults -> capped 100", async () => {
    makeMock({ consultCount: 40, avgRating: 5, ratedRatingCount: 40 });
    const r = await A.calcAttitudeScore(1, 2024, 1);
    expect(r.score).toBe(100);
  });
});

function mockUniformScore(score) {
  pool.execute.mockImplementation(async (sql, params) => {
    if (/FROM\s+assessment_config/i.test(sql)) {
      const key = params[0];
      const v = DEFAULT_CONFIG[key];
      return v ? [[{ config_value: v }]] : [[]];
    }
    if (/AVG\(satisfaction_score\)/i.test(sql)) {
      return [[{ avgSatisfaction: score / 20, ratedCount: 5 }]];
    }
    if (/TIMESTAMPDIFF/i.test(sql)) {
      return [[{ caseCount: 5, avgCycle: 60 / (score / 100) }]];
    }
    if (/as\s+caseCount\s+FROM\s+cases/i.test(sql)) {
      return [[{ caseCount: 5 }]];
    }
    if (/as\s+count\s+FROM\s+cases/i.test(sql)) {
      return [[{ count: (score / 100) * 8 }]];
    }
    if (/FROM\s+complaints/i.test(sql)) {
      return [[{ complaintCount: 0 }]];
    }
    if (/AVG\(rating\)/i.test(sql)) {
      return [[{ avgRating: score / 20, ratedCount: 5 }]];
    }
    if (/as\s+consultCount\s+FROM\s+consultations/i.test(sql)) {
      return [[{ consultCount: (score / 100) * 20 }]];
    }
    return [[]];
  });
}

describe("calculateAssessment grade thresholds", () => {
  test("85 -> excellent", async () => {
    mockUniformScore(85);
    const r = await A.calculateAssessment(1, 2024, 1);
    expect(r.totalScore).toBe(85);
    expect(r.grade).toBe("\u4f18\u79c0");
  });

  test("84 -> good", async () => {
    mockUniformScore(84);
    const r = await A.calculateAssessment(1, 2024, 1);
    expect(r.totalScore).toBe(84);
    expect(r.grade).toBe("\u826f\u597d");
  });

  test("70 -> good", async () => {
    mockUniformScore(70);
    const r = await A.calculateAssessment(1, 2024, 1);
    expect(r.totalScore).toBe(70);
    expect(r.grade).toBe("\u826f\u597d");
  });

  test("69 -> pass", async () => {
    mockUniformScore(69);
    const r = await A.calculateAssessment(1, 2024, 1);
    expect(r.totalScore).toBe(69);
    expect(r.grade).toBe("\u5408\u683c");
  });

  test("60 -> pass", async () => {
    mockUniformScore(60);
    const r = await A.calculateAssessment(1, 2024, 1);
    expect(r.totalScore).toBe(60);
    expect(r.grade).toBe("\u5408\u683c");
  });

  test("59 -> needs improvement", async () => {
    mockUniformScore(59);
    const r = await A.calculateAssessment(1, 2024, 1);
    expect(r.totalScore).toBe(59);
    expect(r.grade).toBe("\u5f85\u6539\u8fdb");
  });

  test("returns full fields", async () => {
    mockUniformScore(100);
    const r = await A.calculateAssessment(7, 2024, 2);
    expect(r).toEqual(expect.objectContaining({
      lawyerId: 7,
      year: 2024,
      quarter: 2,
      caseCountScore: expect.any(Number),
      qualityScore: expect.any(Number),
      efficiencyScore: expect.any(Number),
      attitudeScore: expect.any(Number),
      totalScore: 100,
      grade: "\u4f18\u79c0",
    }));
  });
});

function mockYearly(opts) {
  const lawyers = opts.lawyers;
  const quartersByLawyer = opts.quartersByLawyer || {};
  const prevYearByLawyer = opts.prevYearByLawyer || {};
  const existingByLawyer = opts.existingByLawyer || {};
  pool.execute.mockImplementation(async (sql, params) => {
    if (/SELECT\s+id\s+FROM\s+lawyers/i.test(sql)) {
      return [lawyers.map((id) => ({ id }))];
    }
    if (/FROM\s+quarterly_assessments/i.test(sql)) {
      const lid = params[0];
      return [quartersByLawyer[lid] || []];
    }
    if (/SELECT\s+consecutive_d_years\s+FROM\s+yearly_ratings/i.test(sql)) {
      const lid = params[0];
      const prev = prevYearByLawyer[lid];
      return prev !== undefined ? [[{ consecutive_d_years: prev }]] : [[]];
    }
    if (/SELECT\s+id\s+FROM\s+yearly_ratings/i.test(sql)) {
      const lid = params[0];
      return existingByLawyer[lid] ? [[{ id: 999 }]] : [[]];
    }
    if (/INSERT\s+INTO\s+yearly_ratings/i.test(sql) ||
        /UPDATE\s+yearly_ratings/i.test(sql)) {
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });
}

describe("generateYearlyRating (yearly)", () => {
  test("no quarterly records -> avgScore 0, grade C", async () => {
    mockYearly({ lawyers: [1], quartersByLawyer: { 1: [] } });
    const out = await A.generateYearlyRating(2024);
    expect(out.results).toHaveLength(1);
    expect(out.results[0].avgScore).toBe(0);
    expect(out.results[0].grade).toBe("C");
    expect(out.results[0].consecutiveDYears).toBe(0);
    expect(out.results[0].suggestTerminate).toBe(0);
    expect(out.results[0].subsidyIncrease).toBe(0);
    expect(out.results[0].q1Score).toBeNull();
  });

  test("avg >= 85 -> A, subsidy increase", async () => {
    mockYearly({
      lawyers: [1],
      quartersByLawyer: {
        1: [
          { quarter: 1, total_score: "90.00", grade: "A" },
          { quarter: 2, total_score: "85.00", grade: "A" },
          { quarter: 3, total_score: "88.00", grade: "A" },
          { quarter: 4, total_score: "92.00", grade: "A" },
        ],
      },
    });
    const out = await A.generateYearlyRating(2024);
    expect(out.results[0].grade).toBe("A");
    expect(out.results[0].subsidyIncrease).toBe(1);
    expect(out.results[0].suggestTerminate).toBe(0);
    expect(out.results[0].avgScore).toBeCloseTo(88.75, 2);
    expect(out.results[0].q1Score).toBe("90.00");
  });

  test("avg in [70,85) -> B", async () => {
    mockYearly({
      lawyers: [2],
      quartersByLawyer: {
        2: [
          { quarter: 1, total_score: "70.00", grade: "B" },
          { quarter: 2, total_score: "72.00", grade: "B" },
        ],
      },
    });
    const out = await A.generateYearlyRating(2024);
    expect(out.results[0].grade).toBe("B");
    expect(out.results[0].subsidyIncrease).toBe(0);
  });

  test("avg in [60,70) -> C", async () => {
    mockYearly({
      lawyers: [3],
      quartersByLawyer: {
        3: [{ quarter: 1, total_score: "60.00", grade: "C" }],
      },
    });
    const out = await A.generateYearlyRating(2024);
    expect(out.results[0].grade).toBe("C");
  });

  test("first year D -> consecutiveD 1, no terminate", async () => {
    mockYearly({
      lawyers: [4],
      quartersByLawyer: {
        4: [{ quarter: 1, total_score: "50.00", grade: "D" }],
      },
    });
    const out = await A.generateYearlyRating(2024);
    expect(out.results[0].grade).toBe("D");
    expect(out.results[0].consecutiveDYears).toBe(1);
    expect(out.results[0].suggestTerminate).toBe(0);
  });

  test("two consecutive D -> suggest terminate", async () => {
    mockYearly({
      lawyers: [5],
      quartersByLawyer: {
        5: [{ quarter: 1, total_score: "40.00", grade: "D" }],
      },
      prevYearByLawyer: { 5: 1 },
    });
    const out = await A.generateYearlyRating(2024);
    expect(out.results[0].grade).toBe("D");
    expect(out.results[0].consecutiveDYears).toBe(2);
    expect(out.results[0].suggestTerminate).toBe(1);
  });

  test("non-D does not query consecutive_d_years", async () => {
    mockYearly({
      lawyers: [6],
      quartersByLawyer: {
        6: [{ quarter: 1, total_score: "90.00", grade: "A" }],
      },
    });
    await A.generateYearlyRating(2024);
    const calls = pool.execute.mock.calls.map((c) => c[0]);
    const hasPrev = calls.some((sql) => /SELECT\s+consecutive_d_years/i.test(sql));
    expect(hasPrev).toBe(false);
  });
});
