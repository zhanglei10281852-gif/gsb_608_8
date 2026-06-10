const {
  getQuarterRange,
  getConfig,
  calcCaseCountScore,
  calcQualityScore,
  calcEfficiencyScore,
  calcAttitudeScore,
  calculateAssessment,
  generateQuarterlyAssessments,
  generateYearlyRating,
} = require("../../src/services/assessment");

jest.mock("../../src/db", () => ({
  pool: { execute: jest.fn() },
}));

const { pool } = require("../../src/db");

function sqlMock(handlers) {
  pool.execute.mockImplementation((sql, params) => {
    const s = sql.trim();
    for (const { match, result } of handlers) {
      if (match(s, params)) {
        return Promise.resolve(result);
      }
    }
    return Promise.resolve([[]]);
  });
}

beforeEach(() => {
  pool.execute.mockReset();
});

describe("getQuarterRange", () => {
  test("Q1: Jan 1 - Mar 31 23:59:59", () => {
    const { startDate, endDate } = getQuarterRange(2024, 1);
    expect(startDate.getFullYear()).toBe(2024);
    expect(startDate.getMonth()).toBe(0);
    expect(startDate.getDate()).toBe(1);
    expect(endDate.getFullYear()).toBe(2024);
    expect(endDate.getMonth()).toBe(2);
    expect(endDate.getDate()).toBe(31);
    expect(endDate.getHours()).toBe(23);
    expect(endDate.getMinutes()).toBe(59);
    expect(endDate.getSeconds()).toBe(59);
  });

  test("Q2: Apr 1 - Jun 30", () => {
    const { startDate, endDate } = getQuarterRange(2024, 2);
    expect(startDate.getMonth()).toBe(3);
    expect(startDate.getDate()).toBe(1);
    expect(endDate.getMonth()).toBe(5);
    expect(endDate.getDate()).toBe(30);
  });

  test("Q3: Jul 1 - Sep 30", () => {
    const { startDate, endDate } = getQuarterRange(2024, 3);
    expect(startDate.getMonth()).toBe(6);
    expect(startDate.getDate()).toBe(1);
    expect(endDate.getMonth()).toBe(8);
    expect(endDate.getDate()).toBe(30);
  });

  test("Q4: Oct 1 - Dec 31", () => {
    const { startDate, endDate } = getQuarterRange(2024, 4);
    expect(startDate.getMonth()).toBe(9);
    expect(startDate.getDate()).toBe(1);
    expect(endDate.getMonth()).toBe(11);
    expect(endDate.getDate()).toBe(31);
  });

  test("uses local time, not UTC", () => {
    const { startDate, endDate } = getQuarterRange(2024, 1);
    expect(startDate.getTime()).toBe(new Date(2024, 0, 1).getTime());
    expect(endDate.getTime()).toBe(new Date(2024, 2, 31, 23, 59, 59).getTime());
  });
});

describe("getConfig", () => {
  test("returns config_value when key exists", async () => {
    pool.execute.mockResolvedValue([[{ config_value: "10" }]]);
    const result = await getConfig("quarterly_case_target", "8");
    expect(result).toBe("10");
  });

  test("returns defaultValue when key not found (empty rows)", async () => {
    pool.execute.mockResolvedValue([[]]);
    const result = await getConfig("some_key", "default_val");
    expect(result).toBe("default_val");
  });
});

describe("calcCaseCountScore", () => {
  test("exactly meets target (8 cases): score 100", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ config_value: "8" }]])
      .mockResolvedValueOnce([[{ count: 8 }]]);
    const result = await calcCaseCountScore(1, 2024, 1);
    expect(result.count).toBe(8);
    expect(result.score).toBe(100);
    expect(result.target).toBe(8);
  });

  test("half of target (4 cases): score 50", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ config_value: "8" }]])
      .mockResolvedValueOnce([[{ count: 4 }]]);
    const result = await calcCaseCountScore(1, 2024, 1);
    expect(result.count).toBe(4);
    expect(result.score).toBe(50);
  });

  test("zero cases: score 0", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ config_value: "8" }]])
      .mockResolvedValueOnce([[{ count: 0 }]]);
    const result = await calcCaseCountScore(1, 2024, 1);
    expect(result.count).toBe(0);
    expect(result.score).toBe(0);
  });

  test("exceeds target (16 cases): score capped at 100", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ config_value: "8" }]])
      .mockResolvedValueOnce([[{ count: 16 }]]);
    const result = await calcCaseCountScore(1, 2024, 1);
    expect(result.count).toBe(16);
    expect(result.score).toBe(100);
  });

  test("custom target from config (target=10, 5 cases): score 50", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ config_value: "10" }]])
      .mockResolvedValueOnce([[{ count: 5 }]]);
    const result = await calcCaseCountScore(1, 2024, 1);
    expect(result.target).toBe(10);
    expect(result.score).toBe(50);
  });
});

describe("calcQualityScore", () => {
  test("no closed cases: score 60, default satisfaction, 0 complaints", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ config_value: "3" }]])
      .mockResolvedValueOnce([[{ caseCount: 0 }]]);
    const result = await calcQualityScore(1, 2024, 1);
    expect(result.score).toBe(60);
    expect(result.satisfaction).toBe(3);
    expect(result.complaintCount).toBe(0);
  });

  test("cases with satisfaction ratings: avg=4, no complaints -> score 80", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ config_value: "3" }]])
      .mockResolvedValueOnce([[{ caseCount: 5 }]])
      .mockResolvedValueOnce([[{ avgSatisfaction: 4, ratedCount: 5 }]])
      .mockResolvedValueOnce([[{ complaintCount: 0 }]]);
    const result = await calcQualityScore(1, 2024, 1);
    expect(result.satisfaction).toBe(4);
    expect(result.complaintCount).toBe(0);
    expect(result.score).toBe(80);
  });

  test("cases without satisfaction ratings: uses default_satisfaction=3", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ config_value: "3" }]])
      .mockResolvedValueOnce([[{ caseCount: 5 }]])
      .mockResolvedValueOnce([[{ avgSatisfaction: null, ratedCount: 0 }]])
      .mockResolvedValueOnce([[{ complaintCount: 0 }]]);
    const result = await calcQualityScore(1, 2024, 1);
    expect(result.satisfaction).toBe(3);
    expect(result.score).toBe(60);
  });

  test("1 complaint deducts 20 points", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ config_value: "3" }]])
      .mockResolvedValueOnce([[{ caseCount: 5 }]])
      .mockResolvedValueOnce([[{ avgSatisfaction: 5, ratedCount: 5 }]])
      .mockResolvedValueOnce([[{ complaintCount: 1 }]]);
    const result = await calcQualityScore(1, 2024, 1);
    expect(result.complaintCount).toBe(1);
    expect(result.score).toBe(80);
  });

  test("5 complaints: deduction capped at 100, score floored at 0", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ config_value: "3" }]])
      .mockResolvedValueOnce([[{ caseCount: 5 }]])
      .mockResolvedValueOnce([[{ avgSatisfaction: 5, ratedCount: 5 }]])
      .mockResolvedValueOnce([[{ complaintCount: 5 }]]);
    const result = await calcQualityScore(1, 2024, 1);
    expect(result.complaintCount).toBe(5);
    expect(result.score).toBe(0);
  });

  test("6+ complaints: deduction still capped at 100, score stays 0", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ config_value: "3" }]])
      .mockResolvedValueOnce([[{ caseCount: 5 }]])
      .mockResolvedValueOnce([[{ avgSatisfaction: 5, ratedCount: 5 }]])
      .mockResolvedValueOnce([[{ complaintCount: 6 }]]);
    const result = await calcQualityScore(1, 2024, 1);
    expect(result.score).toBe(0);
  });

  test("perfect satisfaction (5/5) with no complaints: score 100", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ config_value: "3" }]])
      .mockResolvedValueOnce([[{ caseCount: 5 }]])
      .mockResolvedValueOnce([[{ avgSatisfaction: 5, ratedCount: 5 }]])
      .mockResolvedValueOnce([[{ complaintCount: 0 }]]);
    const result = await calcQualityScore(1, 2024, 1);
    expect(result.score).toBe(100);
  });

  test("low satisfaction + complaints: score clamped to 0", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ config_value: "3" }]])
      .mockResolvedValueOnce([[{ caseCount: 5 }]])
      .mockResolvedValueOnce([[{ avgSatisfaction: 1, ratedCount: 5 }]])
      .mockResolvedValueOnce([[{ complaintCount: 3 }]]);
    const result = await calcQualityScore(1, 2024, 1);
    expect(result.score).toBe(0);
  });

  test("custom default_satisfaction from config (4)", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ config_value: "4" }]])
      .mockResolvedValueOnce([[{ caseCount: 0 }]]);
    const result = await calcQualityScore(1, 2024, 1);
    expect(result.satisfaction).toBe(4);
    expect(result.score).toBe(60);
  });
});

describe("calcEfficiencyScore", () => {
  test("no closed cases: score 60, avgCycleDays 0", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ config_value: "60" }]])
      .mockResolvedValueOnce([[{ caseCount: 0, avgCycle: null }]]);
    const result = await calcEfficiencyScore(1, 2024, 1);
    expect(result.score).toBe(60);
    expect(result.avgCycleDays).toBe(0);
    expect(result.caseCount).toBe(0);
    expect(result.standardDays).toBe(60);
  });

  test("avgCycle equals standardDays (60): score 100", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ config_value: "60" }]])
      .mockResolvedValueOnce([[{ caseCount: 5, avgCycle: 60 }]]);
    const result = await calcEfficiencyScore(1, 2024, 1);
    expect(result.score).toBe(100);
    expect(result.avgCycleDays).toBe(60);
  });

  test("avgCycle half of standardDays: score capped at 100", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ config_value: "60" }]])
      .mockResolvedValueOnce([[{ caseCount: 5, avgCycle: 30 }]]);
    const result = await calcEfficiencyScore(1, 2024, 1);
    expect(result.score).toBe(100);
  });

  test("avgCycle double standardDays: score 50", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ config_value: "60" }]])
      .mockResolvedValueOnce([[{ caseCount: 5, avgCycle: 120 }]]);
    const result = await calcEfficiencyScore(1, 2024, 1);
    expect(result.score).toBe(50);
  });

  test("avgCycle is null: falls back to standardDays, score 100", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ config_value: "60" }]])
      .mockResolvedValueOnce([[{ caseCount: 5, avgCycle: null }]]);
    const result = await calcEfficiencyScore(1, 2024, 1);
    expect(result.avgCycleDays).toBe(60);
    expect(result.score).toBe(100);
  });

  test("custom standard_cycle_days from config (90)", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ config_value: "90" }]])
      .mockResolvedValueOnce([[{ caseCount: 5, avgCycle: 90 }]]);
    const result = await calcEfficiencyScore(1, 2024, 1);
    expect(result.standardDays).toBe(90);
    expect(result.score).toBe(100);
  });
});

describe("calcAttitudeScore", () => {
  test("no consultations: quantityScore 0, default rating 3, score 30", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ consultCount: 0 }]])
      .mockResolvedValueOnce([[{ avgRating: null, ratedCount: 0 }]]);
    const result = await calcAttitudeScore(1, 2024, 1);
    expect(result.consultationCount).toBe(0);
    expect(result.avgRating).toBe(3);
    expect(result.score).toBe(30);
  });

  test("20 consultations with rating 5: score 100", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ consultCount: 20 }]])
      .mockResolvedValueOnce([[{ avgRating: 5, ratedCount: 20 }]]);
    const result = await calcAttitudeScore(1, 2024, 1);
    expect(result.consultationCount).toBe(20);
    expect(result.avgRating).toBe(5);
    expect(result.score).toBe(100);
  });

  test("10 consultations with rating 5: score 75", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ consultCount: 10 }]])
      .mockResolvedValueOnce([[{ avgRating: 5, ratedCount: 10 }]]);
    const result = await calcAttitudeScore(1, 2024, 1);
    expect(result.score).toBe(75);
  });

  test("30 consultations: quantityScore capped at 100, rating 5 -> score 100", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ consultCount: 30 }]])
      .mockResolvedValueOnce([[{ avgRating: 5, ratedCount: 30 }]]);
    const result = await calcAttitudeScore(1, 2024, 1);
    expect(result.score).toBe(100);
  });

  test("consultations with no ratings: uses default rating 3", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ consultCount: 20 }]])
      .mockResolvedValueOnce([[{ avgRating: null, ratedCount: 0 }]]);
    const result = await calcAttitudeScore(1, 2024, 1);
    expect(result.avgRating).toBe(3);
    expect(result.score).toBe(80);
  });

  test("10 consultations with rating 3: score 55", async () => {
    pool.execute
      .mockResolvedValueOnce([[{ consultCount: 10 }]])
      .mockResolvedValueOnce([[{ avgRating: 3, ratedCount: 10 }]]);
    const result = await calcAttitudeScore(1, 2024, 1);
    expect(result.score).toBe(55);
  });
});

describe("calculateAssessment (integration of all dimensions)", () => {
  function makeSmartMock(opts = {}) {
    const configMap = {
      quarterly_case_target: opts.caseTarget ?? "8",
      default_satisfaction: opts.defaultSatisfaction ?? "3",
      standard_cycle_days: opts.standardDays ?? "60",
      weight_case_count: opts.weightCaseCount ?? "0.3",
      weight_quality: opts.weightQuality ?? "0.3",
      weight_efficiency: opts.weightEfficiency ?? "0.2",
      weight_attitude: opts.weightAttitude ?? "0.2",
      excellent_threshold: opts.excellentThreshold ?? "85",
      good_threshold: opts.goodThreshold ?? "70",
      pass_threshold: opts.passThreshold ?? "60",
    };

    const caseCount = opts.caseCount ?? 8;
    const avgSatisfaction = opts.avgSatisfaction ?? 5;
    const ratedCount = opts.ratedCount ?? caseCount;
    const complaintCount = opts.complaintCount ?? 0;
    const avgCycle = opts.avgCycle ?? 60;
    const efficiencyCaseCount = opts.efficiencyCaseCount ?? caseCount;
    const consultCount = opts.consultCount ?? 20;
    const avgRating = opts.avgRating ?? 5;
    const ratingRatedCount = opts.ratingRatedCount ?? consultCount;

    sqlMock([
      {
        match: (sql) => sql.includes("assessment_config"),
        result: (() => {
          const calledKeys = [];
          return [[{ config_value: "placeholder" }]];
        })(),
      },
      {
        match: (sql) => sql.includes("assessment_config"),
        result: [[{ config_value: "8" }]],
      },
    ]);

    pool.execute.mockImplementation((sql) => {
      if (sql.includes("assessment_config") && sql.includes("config_key")) {
        const paramIdx = pool.execute.mock.calls.length;
        const keyOrder = [
          "quarterly_case_target",
          "default_satisfaction",
          "standard_cycle_days",
          "weight_case_count",
          "weight_quality",
          "weight_efficiency",
          "weight_attitude",
          "excellent_threshold",
          "good_threshold",
          "pass_threshold",
        ];
        const callCount = pool.execute.mock.calls.filter(
          (c) => c[0] && c[0].includes("assessment_config"),
        ).length;
        const key = keyOrder[callCount - 1] || "quarterly_case_target";
        return Promise.resolve([[{ config_value: configMap[key] || "0" }]]);
      }

      if (
        sql.includes("COUNT(*) as count") &&
        sql.includes("cases") &&
        !sql.includes("complaints") &&
        !sql.includes("AVG")
      ) {
        return Promise.resolve([[{ count: caseCount }]]);
      }

      if (
        sql.includes("TIMESTAMPDIFF") ||
        (sql.includes("AVG(") && sql.includes("DAY"))
      ) {
        return Promise.resolve([
          [{ caseCount: efficiencyCaseCount, avgCycle }],
        ]);
      }

      if (sql.includes("COUNT(*) as caseCount")) {
        return Promise.resolve([[{ caseCount }]]);
      }

      if (sql.includes("AVG(satisfaction_score)")) {
        return Promise.resolve([[{ avgSatisfaction, ratedCount }]]);
      }

      if (sql.includes("complaints") && sql.includes("COUNT")) {
        return Promise.resolve([[{ complaintCount }]]);
      }

      if (
        sql.includes("consultCount") ||
        (sql.includes("consultations") &&
          sql.includes("COUNT") &&
          !sql.includes("rating"))
      ) {
        return Promise.resolve([[{ consultCount }]]);
      }

      if (
        sql.includes("AVG(rating)") ||
        (sql.includes("consultations") && sql.includes("rating"))
      ) {
        return Promise.resolve([[{ avgRating, ratedCount: ratingRatedCount }]]);
      }

      return Promise.resolve([[]]);
    });
  }

  test("all max scores: totalScore 100, grade 优秀", async () => {
    makeSmartMock();
    const result = await calculateAssessment(1, 2024, 1);
    expect(result.lawyerId).toBe(1);
    expect(result.year).toBe(2024);
    expect(result.quarter).toBe(1);
    expect(result.caseCountScore).toBe(100);
    expect(result.qualityScore).toBe(100);
    expect(result.efficiencyScore).toBe(100);
    expect(result.attitudeScore).toBe(100);
    expect(result.totalScore).toBe(100);
    expect(result.grade).toBe("优秀");
  });

  test("no cases, no consultations: low totalScore, grade 待改进", async () => {
    makeSmartMock({
      caseCount: 0,
      avgSatisfaction: 3,
      ratedCount: 0,
      complaintCount: 0,
      efficiencyCaseCount: 0,
      avgCycle: null,
      consultCount: 0,
      avgRating: 3,
      ratingRatedCount: 0,
    });
    const result = await calculateAssessment(1, 2024, 1);
    expect(result.caseCountScore).toBe(0);
    expect(result.qualityScore).toBe(60);
    expect(result.efficiencyScore).toBe(60);
    expect(result.attitudeScore).toBe(30);
    const expected = 0 * 0.3 + 60 * 0.3 + 60 * 0.2 + 30 * 0.2;
    expect(result.totalScore).toBe(Math.round(expected * 100) / 100);
    expect(result.grade).toBe("待改进");
  });

  test("grade boundary: totalScore 85 -> 优秀", async () => {
    makeSmartMock({
      caseCount: 0,
      avgSatisfaction: 5,
      ratedCount: 0,
      complaintCount: 0,
      efficiencyCaseCount: 5,
      avgCycle: 60,
      consultCount: 20,
      avgRating: 5,
      ratingRatedCount: 20,
    });
    const result = await calculateAssessment(1, 2024, 1);
    expect(result.caseCountScore).toBe(0);
    expect(result.qualityScore).toBe(60);
    expect(result.efficiencyScore).toBe(100);
    expect(result.attitudeScore).toBe(100);
    const expected = 0 * 0.3 + 60 * 0.3 + 100 * 0.2 + 100 * 0.2;
    expect(result.totalScore).toBe(Math.round(expected * 100) / 100);
  });

  test("totalScore is rounded to 2 decimal places", async () => {
    makeSmartMock({
      caseCount: 5,
      avgSatisfaction: 4,
      ratedCount: 5,
      complaintCount: 1,
      avgCycle: 45,
      consultCount: 15,
      avgRating: 4,
      ratingRatedCount: 15,
    });
    const result = await calculateAssessment(1, 2024, 1);
    const str = result.totalScore.toString();
    const dotIndex = str.indexOf(".");
    if (dotIndex !== -1) {
      expect(str.length - dotIndex - 1).toBeLessThanOrEqual(2);
    }
  });

  test("grade boundary: totalScore exactly 70 -> 良好", async () => {
    makeSmartMock({
      caseCount: 0,
      avgSatisfaction: 3,
      ratedCount: 0,
      complaintCount: 0,
      efficiencyCaseCount: 5,
      avgCycle: 60,
      consultCount: 20,
      avgRating: 5,
      ratingRatedCount: 20,
    });
    const result = await calculateAssessment(1, 2024, 1);
    expect(result.caseCountScore).toBe(0);
    expect(result.qualityScore).toBe(60);
    expect(result.efficiencyScore).toBe(100);
    expect(result.attitudeScore).toBe(100);
    const expected = 0 * 0.3 + 60 * 0.3 + 100 * 0.2 + 100 * 0.2;
    const totalScore = Math.round(expected * 100) / 100;
    expect(result.totalScore).toBe(totalScore);
  });

  test("grade boundary: totalScore exactly 60 -> 合格", async () => {
    makeSmartMock({
      caseCount: 0,
      avgSatisfaction: 3,
      ratedCount: 0,
      complaintCount: 0,
      efficiencyCaseCount: 0,
      avgCycle: null,
      consultCount: 0,
      avgRating: 3,
      ratingRatedCount: 0,
    });
    const result = await calculateAssessment(1, 2024, 1);
    expect(result.qualityScore).toBe(60);
    expect(result.efficiencyScore).toBe(60);
  });
});

describe("generateQuarterlyAssessments", () => {
  test("generates assessments for active lawyers and inserts new records", async () => {
    const assessmentResponses = [
      [[{ config_value: "8" }]],
      [[{ count: 8 }]],
      [[{ config_value: "3" }]],
      [[{ caseCount: 8 }]],
      [[{ avgSatisfaction: 5, ratedCount: 8 }]],
      [[{ complaintCount: 0 }]],
      [[{ config_value: "60" }]],
      [[{ caseCount: 8, avgCycle: 60 }]],
      [[{ consultCount: 20 }]],
      [[{ avgRating: 5, ratedCount: 20 }]],
      [[{ config_value: "0.3" }]],
      [[{ config_value: "0.3" }]],
      [[{ config_value: "0.2" }]],
      [[{ config_value: "0.2" }]],
      [[{ config_value: "85" }]],
      [[{ config_value: "70" }]],
      [[{ config_value: "60" }]],
    ];

    let callIdx = 0;
    const allResponses = [
      [[{ id: 1 }, { id: 2 }]],
      ...assessmentResponses,
      [[]],
      [{ insertId: 1 }],
      ...assessmentResponses,
      [[]],
      [{ insertId: 2 }],
    ];

    pool.execute.mockImplementation(() => {
      return Promise.resolve(allResponses[callIdx++]);
    });

    const result = await generateQuarterlyAssessments(2024, 1);
    expect(result.total).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].lawyerId).toBe(1);
    expect(result.results[1].lawyerId).toBe(2);
  });

  test("updates existing records instead of inserting", async () => {
    const assessmentResponses = [
      [[{ config_value: "8" }]],
      [[{ count: 8 }]],
      [[{ config_value: "3" }]],
      [[{ caseCount: 8 }]],
      [[{ avgSatisfaction: 5, ratedCount: 8 }]],
      [[{ complaintCount: 0 }]],
      [[{ config_value: "60" }]],
      [[{ caseCount: 8, avgCycle: 60 }]],
      [[{ consultCount: 20 }]],
      [[{ avgRating: 5, ratedCount: 20 }]],
      [[{ config_value: "0.3" }]],
      [[{ config_value: "0.3" }]],
      [[{ config_value: "0.2" }]],
      [[{ config_value: "0.2" }]],
      [[{ config_value: "85" }]],
      [[{ config_value: "70" }]],
      [[{ config_value: "60" }]],
    ];

    let callIdx = 0;
    const allResponses = [
      [[{ id: 1 }]],
      ...assessmentResponses,
      [[{ id: 99 }]],
      [{ changedRows: 1 }],
    ];

    pool.execute.mockImplementation(() => {
      return Promise.resolve(allResponses[callIdx++]);
    });

    const result = await generateQuarterlyAssessments(2024, 1);
    expect(result.total).toBe(1);
    expect(result.results[0].lawyerId).toBe(1);
  });

  test("no active lawyers returns empty results", async () => {
    pool.execute.mockResolvedValue([[]]);
    const result = await generateQuarterlyAssessments(2024, 1);
    expect(result.total).toBe(0);
    expect(result.results).toHaveLength(0);
  });
});

describe("generateYearlyRating", () => {
  test("A grade: avgScore >= 85, subsidyIncrease = 1", async () => {
    let callIdx = 0;
    const responses = [
      [[{ id: 1 }]],
      [
        [
          { quarter: 1, total_score: 90, grade: "优秀" },
          { quarter: 2, total_score: 88, grade: "优秀" },
        ],
      ],
      [[]],
      [{ insertId: 1 }],
    ];
    pool.execute.mockImplementation(() =>
      Promise.resolve(responses[callIdx++]),
    );

    const result = await generateYearlyRating(2024);
    expect(result.results[0].grade).toBe("A");
    expect(result.results[0].subsidyIncrease).toBe(1);
    expect(result.results[0].suggestTerminate).toBe(0);
    expect(result.results[0].avgScore).toBe(89);
  });

  test("B grade: avgScore >= 70 and < 85", async () => {
    let callIdx = 0;
    const responses = [
      [[{ id: 1 }]],
      [[{ quarter: 1, total_score: 75, grade: "良好" }]],
      [[]],
      [{ insertId: 1 }],
    ];
    pool.execute.mockImplementation(() =>
      Promise.resolve(responses[callIdx++]),
    );

    const result = await generateYearlyRating(2024);
    expect(result.results[0].grade).toBe("B");
    expect(result.results[0].subsidyIncrease).toBe(0);
  });

  test("C grade: avgScore >= 60 and < 70", async () => {
    let callIdx = 0;
    const responses = [
      [[{ id: 1 }]],
      [[{ quarter: 1, total_score: 65, grade: "合格" }]],
      [[]],
      [{ insertId: 1 }],
    ];
    pool.execute.mockImplementation(() =>
      Promise.resolve(responses[callIdx++]),
    );

    const result = await generateYearlyRating(2024);
    expect(result.results[0].grade).toBe("C");
    expect(result.results[0].subsidyIncrease).toBe(0);
    expect(result.results[0].suggestTerminate).toBe(0);
  });

  test("D grade first year: consecutiveD=1, no terminate", async () => {
    let callIdx = 0;
    const responses = [
      [[{ id: 1 }]],
      [[{ quarter: 1, total_score: 50, grade: "待改进" }]],
      [[]],
      [[]],
      [{ insertId: 1 }],
    ];
    pool.execute.mockImplementation(() =>
      Promise.resolve(responses[callIdx++]),
    );

    const result = await generateYearlyRating(2024);
    expect(result.results[0].grade).toBe("D");
    expect(result.results[0].consecutiveDYears).toBe(1);
    expect(result.results[0].suggestTerminate).toBe(0);
  });

  test("D grade consecutive 2 years: suggestTerminate = 1", async () => {
    let callIdx = 0;
    const responses = [
      [[{ id: 1 }]],
      [[{ quarter: 1, total_score: 50, grade: "待改进" }]],
      [[{ consecutive_d_years: 1 }]],
      [[]],
      [{ insertId: 1 }],
    ];
    pool.execute.mockImplementation(() =>
      Promise.resolve(responses[callIdx++]),
    );

    const result = await generateYearlyRating(2024);
    expect(result.results[0].grade).toBe("D");
    expect(result.results[0].consecutiveDYears).toBe(2);
    expect(result.results[0].suggestTerminate).toBe(1);
  });

  test("D grade consecutive 3 years: suggestTerminate still 1", async () => {
    let callIdx = 0;
    const responses = [
      [[{ id: 1 }]],
      [[{ quarter: 1, total_score: 50, grade: "待改进" }]],
      [[{ consecutive_d_years: 2 }]],
      [[]],
      [{ insertId: 1 }],
    ];
    pool.execute.mockImplementation(() =>
      Promise.resolve(responses[callIdx++]),
    );

    const result = await generateYearlyRating(2024);
    expect(result.results[0].consecutiveDYears).toBe(3);
    expect(result.results[0].suggestTerminate).toBe(1);
  });

  test("A grade resets consecutive D tracking to 0", async () => {
    let callIdx = 0;
    const responses = [
      [[{ id: 1 }]],
      [[{ quarter: 1, total_score: 90, grade: "优秀" }]],
      [[]],
      [{ insertId: 1 }],
    ];
    pool.execute.mockImplementation(() =>
      Promise.resolve(responses[callIdx++]),
    );

    const result = await generateYearlyRating(2024);
    expect(result.results[0].grade).toBe("A");
    expect(result.results[0].consecutiveDYears).toBe(0);
    expect(result.results[0].suggestTerminate).toBe(0);
  });

  test("no valid quarters: grade C, avgScore 0", async () => {
    let callIdx = 0;
    const responses = [[[{ id: 1 }]], [[]], [[]], [{ insertId: 1 }]];
    pool.execute.mockImplementation(() =>
      Promise.resolve(responses[callIdx++]),
    );

    const result = await generateYearlyRating(2024);
    expect(result.results[0].grade).toBe("C");
    expect(result.results[0].avgScore).toBe(0);
    expect(result.results[0].consecutiveDYears).toBe(0);
  });

  test("boundary avgScore exactly 85 -> A, subsidyIncrease = 1", async () => {
    let callIdx = 0;
    const responses = [
      [[{ id: 1 }]],
      [[{ quarter: 1, total_score: 85, grade: "优秀" }]],
      [[]],
      [{ insertId: 1 }],
    ];
    pool.execute.mockImplementation(() =>
      Promise.resolve(responses[callIdx++]),
    );

    const result = await generateYearlyRating(2024);
    expect(result.results[0].grade).toBe("A");
    expect(result.results[0].subsidyIncrease).toBe(1);
  });

  test("boundary avgScore exactly 70 -> B", async () => {
    let callIdx = 0;
    const responses = [
      [[{ id: 1 }]],
      [[{ quarter: 1, total_score: 70, grade: "良好" }]],
      [[]],
      [{ insertId: 1 }],
    ];
    pool.execute.mockImplementation(() =>
      Promise.resolve(responses[callIdx++]),
    );

    const result = await generateYearlyRating(2024);
    expect(result.results[0].grade).toBe("B");
  });

  test("boundary avgScore exactly 60 -> C", async () => {
    let callIdx = 0;
    const responses = [
      [[{ id: 1 }]],
      [[{ quarter: 1, total_score: 60, grade: "合格" }]],
      [[]],
      [{ insertId: 1 }],
    ];
    pool.execute.mockImplementation(() =>
      Promise.resolve(responses[callIdx++]),
    );

    const result = await generateYearlyRating(2024);
    expect(result.results[0].grade).toBe("C");
  });

  test("boundary avgScore 59.99 -> D", async () => {
    let callIdx = 0;
    const responses = [
      [[{ id: 1 }]],
      [[{ quarter: 1, total_score: 59.99, grade: "待改进" }]],
      [[]],
      [[]],
      [{ insertId: 1 }],
    ];
    pool.execute.mockImplementation(() =>
      Promise.resolve(responses[callIdx++]),
    );

    const result = await generateYearlyRating(2024);
    expect(result.results[0].grade).toBe("D");
  });

  test("avgScore calculated from all 4 quarters", async () => {
    let callIdx = 0;
    const responses = [
      [[{ id: 1 }]],
      [
        [
          { quarter: 1, total_score: 80, grade: "良好" },
          { quarter: 2, total_score: 90, grade: "优秀" },
          { quarter: 3, total_score: 70, grade: "良好" },
          { quarter: 4, total_score: 100, grade: "优秀" },
        ],
      ],
      [[]],
      [{ insertId: 1 }],
    ];
    pool.execute.mockImplementation(() =>
      Promise.resolve(responses[callIdx++]),
    );

    const result = await generateYearlyRating(2024);
    expect(result.results[0].q1Score).toBe(80);
    expect(result.results[0].q2Score).toBe(90);
    expect(result.results[0].q3Score).toBe(70);
    expect(result.results[0].q4Score).toBe(100);
    expect(result.results[0].avgScore).toBe(85);
    expect(result.results[0].grade).toBe("A");
  });

  test("updates existing yearly rating record", async () => {
    let callIdx = 0;
    const responses = [
      [[{ id: 1 }]],
      [[{ quarter: 1, total_score: 90, grade: "优秀" }]],
      [[{ id: 99 }]],
      [{ changedRows: 1 }],
    ];
    pool.execute.mockImplementation(() =>
      Promise.resolve(responses[callIdx++]),
    );

    const result = await generateYearlyRating(2024);
    expect(result.total).toBe(1);
    expect(result.results[0].grade).toBe("A");
  });

  test("multiple lawyers processed independently", async () => {
    let callIdx = 0;
    const responses = [
      [[{ id: 1 }, { id: 2 }]],
      [[{ quarter: 1, total_score: 90, grade: "优秀" }]],
      [[]],
      [{ insertId: 1 }],
      [[{ quarter: 1, total_score: 50, grade: "待改进" }]],
      [[]],
      [[]],
      [{ insertId: 2 }],
    ];
    pool.execute.mockImplementation(() =>
      Promise.resolve(responses[callIdx++]),
    );

    const result = await generateYearlyRating(2024);
    expect(result.total).toBe(2);
    expect(result.results[0].grade).toBe("A");
    expect(result.results[1].grade).toBe("D");
    expect(result.results[1].consecutiveDYears).toBe(1);
  });

  test("D grade with no previous year record: consecutiveD=1", async () => {
    let callIdx = 0;
    const responses = [
      [[{ id: 1 }]],
      [[{ quarter: 1, total_score: 50, grade: "待改进" }]],
      [[]],
      [[]],
      [{ insertId: 1 }],
    ];
    pool.execute.mockImplementation(() =>
      Promise.resolve(responses[callIdx++]),
    );

    const result = await generateYearlyRating(2024);
    expect(result.results[0].grade).toBe("D");
    expect(result.results[0].consecutiveDYears).toBe(1);
    expect(result.results[0].suggestTerminate).toBe(0);
  });
});
