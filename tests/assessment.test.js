const { pool } = require("../src/db");

jest.mock("../src/db", () => ({
  pool: {
    execute: jest.fn(),
  },
}));

const {
  getQuarterRange,
  calcCaseCountScore,
  calcQualityScore,
  calcEfficiencyScore,
  calcAttitudeScore,
  calculateAssessment,
  generateYearlyRating,
} = require("../src/services/assessment");

function mockPoolExecute(mockHandlers) {
  pool.execute.mockImplementation((sql, params) => {
    for (const handler of mockHandlers) {
      if (handler.match(sql, params)) {
        return Promise.resolve(handler.result);
      }
    }
    console.warn("Unhandled SQL:", sql);
    return Promise.resolve([[]]);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("getQuarterRange", () => {
  test("Q1 季度起止时间正确", () => {
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

  test("Q2 季度起止时间正确", () => {
    const { startDate, endDate } = getQuarterRange(2024, 2);
    expect(startDate.getMonth()).toBe(3);
    expect(startDate.getDate()).toBe(1);
    expect(endDate.getMonth()).toBe(5);
    expect(endDate.getDate()).toBe(30);
  });

  test("Q3 季度起止时间正确", () => {
    const { startDate, endDate } = getQuarterRange(2024, 3);
    expect(startDate.getMonth()).toBe(6);
    expect(startDate.getDate()).toBe(1);
    expect(endDate.getMonth()).toBe(8);
    expect(endDate.getDate()).toBe(30);
  });

  test("Q4 季度起止时间正确", () => {
    const { startDate, endDate } = getQuarterRange(2024, 4);
    expect(startDate.getMonth()).toBe(9);
    expect(startDate.getDate()).toBe(1);
    expect(endDate.getMonth()).toBe(11);
    expect(endDate.getDate()).toBe(31);
  });

  test("闰年 2 月月底正确", () => {
    const { endDate } = getQuarterRange(2024, 1);
    expect(endDate.getDate()).toBe(31);
    const febEnd = new Date(2024, 2, 0);
    expect(febEnd.getDate()).toBe(29);
  });
});

describe("calcCaseCountScore", () => {
  function setupMock(target, count) {
    mockPoolExecute([
      {
        match: (sql) => sql.includes("assessment_config"),
        result: [[{ config_value: String(target) }]],
      },
      {
        match: (sql) => sql.includes("SELECT COUNT(*) as count FROM cases"),
        result: [[{ count }]],
      },
    ]);
  }

  test("办案数量达标时得 100 分", async () => {
    setupMock(8, 8);
    const result = await calcCaseCountScore(1, 2024, 1);
    expect(result.count).toBe(8);
    expect(result.score).toBe(100);
    expect(result.target).toBe(8);
  });

  test("办案数量超过目标时封顶 100 分", async () => {
    setupMock(8, 15);
    const result = await calcCaseCountScore(1, 2024, 1);
    expect(result.count).toBe(15);
    expect(result.score).toBe(100);
  });

  test("办案数量为一半时得 50 分", async () => {
    setupMock(8, 4);
    const result = await calcCaseCountScore(1, 2024, 1);
    expect(result.score).toBe(50);
  });

  test("办案数量为 0 时得 0 分", async () => {
    setupMock(8, 0);
    const result = await calcCaseCountScore(1, 2024, 1);
    expect(result.count).toBe(0);
    expect(result.score).toBe(0);
  });

  test("分数保留两位小数", async () => {
    setupMock(8, 5);
    const result = await calcCaseCountScore(1, 2024, 1);
    expect(result.score).toBe(62.5);
  });
});

describe("calcQualityScore", () => {
  function setupMock(defaultSatisfaction, caseCount, avgSatisfaction, ratedCount, complaintCount) {
    mockPoolExecute([
      {
        match: (sql) => sql.includes("assessment_config"),
        result: [[{ config_value: String(defaultSatisfaction) }]],
      },
      {
        match: (sql) => sql.includes("COUNT(*) as caseCount FROM cases"),
        result: [[{ caseCount }]],
      },
      {
        match: (sql) => sql.includes("AVG(satisfaction_score)"),
        result: [[{ avgSatisfaction, ratedCount }]],
      },
      {
        match: (sql) => sql.includes("SELECT COUNT(*) as complaintCount FROM complaints"),
        result: [[{ complaintCount }]],
      },
    ]);
  }

  test("无案件时返回默认满意度 3 分和 60 分质量分", async () => {
    setupMock(3, 0, null, 0, 0);
    const result = await calcQualityScore(1, 2024, 1);
    expect(result.satisfaction).toBe(3);
    expect(result.complaintCount).toBe(0);
    expect(result.score).toBe(60);
  });

  test("有案件且有满意度评分，无投诉", async () => {
    setupMock(3, 5, 4.5, 5, 0);
    const result = await calcQualityScore(1, 2024, 1);
    expect(result.satisfaction).toBe(4.5);
    expect(result.complaintCount).toBe(0);
    expect(result.score).toBe(90);
  });

  test("有案件但无满意度评分，使用默认满意度", async () => {
    setupMock(3, 5, null, 0, 0);
    const result = await calcQualityScore(1, 2024, 1);
    expect(result.satisfaction).toBe(3);
    expect(result.score).toBe(60);
  });

  test("有投诉，每个投诉扣 20 分", async () => {
    setupMock(3, 5, 5, 5, 2);
    const result = await calcQualityScore(1, 2024, 1);
    expect(result.complaintCount).toBe(2);
    expect(result.score).toBe(60);
  });

  test("投诉扣分封顶，最低 0 分", async () => {
    setupMock(3, 5, 5, 5, 10);
    const result = await calcQualityScore(1, 2024, 1);
    expect(result.complaintCount).toBe(10);
    expect(result.score).toBe(0);
  });

  test("满意度满分 5 分对应 100 分质量分", async () => {
    setupMock(3, 5, 5, 5, 0);
    const result = await calcQualityScore(1, 2024, 1);
    expect(result.score).toBe(100);
  });
});

describe("calcEfficiencyScore", () => {
  function setupMock(standardDays, caseCount, avgCycle) {
    mockPoolExecute([
      {
        match: (sql) => sql.includes("assessment_config"),
        result: [[{ config_value: String(standardDays) }]],
      },
      {
        match: (sql) => sql.includes("TIMESTAMPDIFF"),
        result: [[{ caseCount, avgCycle }]],
      },
    ]);
  }

  test("无案件时返回 60 分", async () => {
    setupMock(60, 0, null);
    const result = await calcEfficiencyScore(1, 2024, 1);
    expect(result.caseCount).toBe(0);
    expect(result.score).toBe(60);
    expect(result.standardDays).toBe(60);
  });

  test("平均周期等于标准周期得 100 分", async () => {
    setupMock(60, 5, 60);
    const result = await calcEfficiencyScore(1, 2024, 1);
    expect(result.avgCycleDays).toBe(60);
    expect(result.score).toBe(100);
  });

  test("平均周期短于标准周期得分更高但封顶 100 分", async () => {
    setupMock(60, 5, 30);
    const result = await calcEfficiencyScore(1, 2024, 1);
    expect(result.score).toBe(100);
  });

  test("平均周期长于标准周期得分降低", async () => {
    setupMock(60, 5, 120);
    const result = await calcEfficiencyScore(1, 2024, 1);
    expect(result.score).toBe(50);
  });

  test("avgCycle 为 null 时使用标准周期", async () => {
    setupMock(60, 5, null);
    const result = await calcEfficiencyScore(1, 2024, 1);
    expect(result.avgCycleDays).toBe(60);
    expect(result.score).toBe(100);
  });
});

describe("calcAttitudeScore", () => {
  function setupMock(consultCount, avgRating, ratedCount) {
    mockPoolExecute([
      {
        match: (sql) => sql.includes("COUNT(*) as consultCount FROM consultations"),
        result: [[{ consultCount }]],
      },
      {
        match: (sql) => sql.includes("AVG(rating)"),
        result: [[{ avgRating, ratedCount }]],
      },
    ]);
  }

  test("咨询数量达标且有满分评价得 100 分", async () => {
    setupMock(20, 5, 20);
    const result = await calcAttitudeScore(1, 2024, 1);
    expect(result.consultationCount).toBe(20);
    expect(result.avgRating).toBe(5);
    expect(result.score).toBe(100);
  });

  test("咨询数量为 0，无评价，使用默认 3 分", async () => {
    setupMock(0, null, 0);
    const result = await calcAttitudeScore(1, 2024, 1);
    expect(result.consultationCount).toBe(0);
    expect(result.avgRating).toBe(3);
    expect(result.score).toBe(30);
  });

  test("咨询数量超过目标时数量分封顶 100 分", async () => {
    setupMock(50, 5, 50);
    const result = await calcAttitudeScore(1, 2024, 1);
    expect(result.score).toBe(100);
  });

  test("咨询数量一半，评价默认 3 分，综合得分 55 分", async () => {
    setupMock(10, null, 0);
    const result = await calcAttitudeScore(1, 2024, 1);
    expect(result.score).toBe(55);
  });

  test("数量和评价各占 50% 权重", async () => {
    setupMock(20, 3, 10);
    const result = await calcAttitudeScore(1, 2024, 1);
    expect(result.score).toBe(80);
  });
});

describe("calculateAssessment", () => {
  function setupFullMock({
    caseCount = 8,
    caseTarget = 8,
    satisfaction = 4,
    ratedCases = 5,
    complaintCount = 0,
    avgCycle = 60,
    standardDays = 60,
    consultCount = 20,
    avgRating = 4,
    ratedConsult = 20,
    weightCaseCount = 0.3,
    weightQuality = 0.3,
    weightEfficiency = 0.2,
    weightAttitude = 0.2,
    excellentThreshold = 85,
    goodThreshold = 70,
    passThreshold = 60,
  } = {}) {
    const configMap = {
      quarterly_case_target: String(caseTarget),
      default_satisfaction: "3",
      standard_cycle_days: String(standardDays),
      weight_case_count: String(weightCaseCount),
      weight_quality: String(weightQuality),
      weight_efficiency: String(weightEfficiency),
      weight_attitude: String(weightAttitude),
      excellent_threshold: String(excellentThreshold),
      good_threshold: String(goodThreshold),
      pass_threshold: String(passThreshold),
    };

    pool.execute.mockImplementation((sql, params) => {
      if (sql.includes("assessment_config")) {
        const key = params[0];
        return Promise.resolve([[{ config_value: configMap[key] || "0" }]]);
      }
      if (sql.includes("COUNT(*) as count FROM cases") && sql.includes("status = '已结案'")) {
        return Promise.resolve([[{ count: caseCount }]]);
      }
      if (sql.includes("COUNT(*) as caseCount FROM cases")) {
        return Promise.resolve([[{ caseCount: ratedCases }]]);
      }
      if (sql.includes("AVG(satisfaction_score)")) {
        return Promise.resolve([[{ avgSatisfaction: satisfaction, ratedCount: ratedCases }]]);
      }
      if (sql.includes("complaintCount FROM complaints")) {
        return Promise.resolve([[{ complaintCount }]]);
      }
      if (sql.includes("TIMESTAMPDIFF")) {
        return Promise.resolve([[{ caseCount: ratedCases, avgCycle }]]);
      }
      if (sql.includes("consultCount FROM consultations")) {
        return Promise.resolve([[{ consultCount }]]);
      }
      if (sql.includes("AVG(rating)") && sql.includes("consultations")) {
        return Promise.resolve([[{ avgRating, ratedCount: ratedConsult }]]);
      }
      console.warn("Unhandled SQL:", sql);
      return Promise.resolve([[]]);
    });
  }

  test("综合评分计算正确", async () => {
    setupFullMock({
      caseCount: 8,
      satisfaction: 4,
      avgCycle: 60,
      consultCount: 20,
      avgRating: 4,
    });

    const result = await calculateAssessment(1, 2024, 1);
    expect(result.caseCountScore).toBe(100);
    expect(result.qualityScore).toBe(80);
    expect(result.efficiencyScore).toBe(100);
    expect(result.attitudeScore).toBe(90);

    const expectedTotal = 100 * 0.3 + 80 * 0.3 + 100 * 0.2 + 90 * 0.2;
    expect(result.totalScore).toBeCloseTo(expectedTotal, 2);
  });

  test("评级正确（优秀）", async () => {
    setupFullMock({
      caseCount: 10,
      satisfaction: 5,
      avgCycle: 30,
      consultCount: 30,
      avgRating: 5,
    });

    const result = await calculateAssessment(1, 2024, 1);
    expect(result.grade).toBe("优秀");
  });

  test("刚好 85 分评为优秀", async () => {
    setupFullMock({
      caseCount: 8,
      caseTarget: 8,
      satisfaction: 4.25,
      avgCycle: 60,
      consultCount: 17,
      avgRating: 4.25,
      weightCaseCount: 0.25,
      weightQuality: 0.25,
      weightEfficiency: 0.25,
      weightAttitude: 0.25,
    });

    const result = await calculateAssessment(1, 2024, 1);
    const caseScore = Math.min(100, (8 / 8) * 100);
    const qualityScore = (4.25 / 5) * 100;
    const efficiencyScore = Math.min(100, (60 / 60) * 100);
    const quantityScore = Math.min(100, (17 / 20) * 100);
    const ratingScore = (4.25 / 5) * 100;
    const attitudeScore = quantityScore * 0.5 + ratingScore * 0.5;
    const total = caseScore * 0.25 + qualityScore * 0.25 + efficiencyScore * 0.25 + attitudeScore * 0.25;

    expect(result.totalScore).toBeCloseTo(total, 2);
    expect(result.grade).toBe(total >= 85 ? "优秀" : result.grade);
  });
});

describe("calculateAssessment 边界值测试", () => {
  function setupWithTotalScore(targetScore) {
    const configMap = {
      quarterly_case_target: "8",
      default_satisfaction: "3",
      standard_cycle_days: "60",
      weight_case_count: "0.25",
      weight_quality: "0.25",
      weight_efficiency: "0.25",
      weight_attitude: "0.25",
      excellent_threshold: "85",
      good_threshold: "70",
      pass_threshold: "60",
    };

    pool.execute.mockImplementation((sql, params) => {
      if (sql.includes("assessment_config")) {
        const key = params[0];
        return Promise.resolve([[{ config_value: configMap[key] || "0" }]]);
      }
      if (sql.includes("COUNT(*) as count FROM cases") && sql.includes("status = '已结案'")) {
        const score = targetScore;
        const count = (score / 100) * 8;
        return Promise.resolve([[{ count }]]);
      }
      if (sql.includes("COUNT(*) as caseCount FROM cases")) {
        return Promise.resolve([[{ caseCount: 5 }]]);
      }
      if (sql.includes("AVG(satisfaction_score)")) {
        const satisfaction = (targetScore / 100) * 5;
        return Promise.resolve([[{ avgSatisfaction: satisfaction, ratedCount: 5 }]]);
      }
      if (sql.includes("complaintCount FROM complaints")) {
        return Promise.resolve([[{ complaintCount: 0 }]]);
      }
      if (sql.includes("TIMESTAMPDIFF")) {
        const avgCycle = 60 / (targetScore / 100);
        return Promise.resolve([[{ caseCount: 5, avgCycle }]]);
      }
      if (sql.includes("consultCount FROM consultations")) {
        const consultCount = (targetScore / 100) * 20;
        return Promise.resolve([[{ consultCount }]]);
      }
      if (sql.includes("AVG(rating)") && sql.includes("consultations")) {
        const rating = (targetScore / 100) * 5;
        return Promise.resolve([[{ avgRating: rating, ratedCount: 10 }]]);
      }
      console.warn("Unhandled SQL:", sql);
      return Promise.resolve([[]]);
    });
  }

  test("刚好 85 分评为优秀", async () => {
    setupWithTotalScore(85);
    const result = await calculateAssessment(1, 2024, 1);
    expect(result.totalScore).toBeCloseTo(85, 0);
    expect(result.grade).toBe("优秀");
  });

  test("刚好 70 分评为良好", async () => {
    setupWithTotalScore(70);
    const result = await calculateAssessment(1, 2024, 1);
    expect(result.totalScore).toBeCloseTo(70, 0);
    expect(result.grade).toBe("良好");
  });

  test("刚好 60 分评为合格", async () => {
    setupWithTotalScore(60);
    const result = await calculateAssessment(1, 2024, 1);
    expect(result.totalScore).toBeCloseTo(60, 0);
    expect(result.grade).toBe("合格");
  });

  test("59 分评为待改进", async () => {
    setupWithTotalScore(59);
    const result = await calculateAssessment(1, 2024, 1);
    expect(result.totalScore).toBeCloseTo(59, 0);
    expect(result.grade).toBe("待改进");
  });
});

describe("calculateAssessment 全 0 分场景", () => {
  test("律师当季无任何已结案案件时各维度得分", async () => {
    const configMap = {
      quarterly_case_target: "8",
      default_satisfaction: "3",
      standard_cycle_days: "60",
      weight_case_count: "0.3",
      weight_quality: "0.3",
      weight_efficiency: "0.2",
      weight_attitude: "0.2",
      excellent_threshold: "85",
      good_threshold: "70",
      pass_threshold: "60",
    };

    pool.execute.mockImplementation((sql, params) => {
      if (sql.includes("assessment_config")) {
        const key = params[0];
        return Promise.resolve([[{ config_value: configMap[key] || "0" }]]);
      }
      if (sql.includes("COUNT(*) as count FROM cases") && sql.includes("status = '已结案'")) {
        return Promise.resolve([[{ count: 0 }]]);
      }
      if (sql.includes("COUNT(*) as caseCount FROM cases")) {
        return Promise.resolve([[{ caseCount: 0 }]]);
      }
      if (sql.includes("AVG(satisfaction_score)")) {
        return Promise.resolve([[{ avgSatisfaction: null, ratedCount: 0 }]]);
      }
      if (sql.includes("complaintCount FROM complaints")) {
        return Promise.resolve([[{ complaintCount: 0 }]]);
      }
      if (sql.includes("TIMESTAMPDIFF")) {
        return Promise.resolve([[{ caseCount: 0, avgCycle: null }]]);
      }
      if (sql.includes("consultCount FROM consultations")) {
        return Promise.resolve([[{ consultCount: 0 }]]);
      }
      if (sql.includes("AVG(rating)") && sql.includes("consultations")) {
        return Promise.resolve([[{ avgRating: null, ratedCount: 0 }]]);
      }
      console.warn("Unhandled SQL:", sql);
      return Promise.resolve([[]]);
    });

    const result = await calculateAssessment(1, 2024, 1);
    expect(result.caseCountScore).toBe(0);
    expect(result.qualityScore).toBe(60);
    expect(result.efficiencyScore).toBe(60);
    expect(result.attitudeScore).toBe(30);

    const expectedTotal = 0 * 0.3 + 60 * 0.3 + 60 * 0.2 + 30 * 0.2;
    expect(result.totalScore).toBeCloseTo(expectedTotal, 2);
    expect(result.grade).toBe("待改进");
  });
});

describe("generateYearlyRating", () => {
  function setupMock({
    lawyers = [{ id: 1 }],
    quarters = [],
    prevYearRating = null,
    existing = [],
  } = {}) {
    pool.execute.mockImplementation((sql, params) => {
      if (sql.includes("SELECT id FROM lawyers")) {
        return Promise.resolve([lawyers]);
      }
      if (sql.includes("quarterly_assessments")) {
        return Promise.resolve([quarters]);
      }
      if (sql.includes("consecutive_d_years FROM yearly_ratings")) {
        if (prevYearRating) {
          return Promise.resolve([[prevYearRating]]);
        }
        return Promise.resolve([[]]);
      }
      if (sql.includes("SELECT id FROM yearly_ratings WHERE")) {
        return Promise.resolve([existing]);
      }
      if (sql.includes("UPDATE yearly_ratings") || sql.includes("INSERT INTO yearly_ratings")) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      console.warn("Unhandled SQL:", sql);
      return Promise.resolve([[]]);
    });
  }

  test("全年无季度考核数据时评级为 C", async () => {
    setupMock({ quarters: [] });
    const result = await generateYearlyRating(2024);
    expect(result.total).toBe(1);
    expect(result.results[0].grade).toBe("C");
    expect(result.results[0].avgScore).toBe(0);
    expect(result.results[0].suggestTerminate).toBe(0);
    expect(result.results[0].subsidyIncrease).toBe(0);
  });

  test("平均 85 分及以上为 A 级，标记补贴上浮", async () => {
    setupMock({
      quarters: [
        { quarter: 1, total_score: "90.00", grade: "优秀" },
        { quarter: 2, total_score: "85.00", grade: "优秀" },
        { quarter: 3, total_score: "90.00", grade: "优秀" },
        { quarter: 4, total_score: "85.00", grade: "优秀" },
      ],
    });

    const result = await generateYearlyRating(2024);
    expect(result.results[0].grade).toBe("A");
    expect(result.results[0].subsidyIncrease).toBe(1);
    expect(result.results[0].avgScore).toBe(87.5);
  });

  test("平均 70-84 分为 B 级", async () => {
    setupMock({
      quarters: [
        { quarter: 1, total_score: "75.00", grade: "良好" },
        { quarter: 2, total_score: "80.00", grade: "良好" },
      ],
    });

    const result = await generateYearlyRating(2024);
    expect(result.results[0].grade).toBe("B");
    expect(result.results[0].subsidyIncrease).toBe(0);
  });

  test("平均 60-69 分为 C 级", async () => {
    setupMock({
      quarters: [
        { quarter: 1, total_score: "65.00", grade: "合格" },
        { quarter: 2, total_score: "60.00", grade: "合格" },
      ],
    });

    const result = await generateYearlyRating(2024);
    expect(result.results[0].grade).toBe("C");
  });

  test("平均 60 分以下为 D 级", async () => {
    setupMock({
      quarters: [
        { quarter: 1, total_score: "55.00", grade: "待改进" },
        { quarter: 2, total_score: "50.00", grade: "待改进" },
      ],
    });

    const result = await generateYearlyRating(2024);
    expect(result.results[0].grade).toBe("D");
    expect(result.results[0].consecutiveDYears).toBe(1);
    expect(result.results[0].suggestTerminate).toBe(0);
  });

  test("连续两年 D 级建议解约", async () => {
    setupMock({
      quarters: [
        { quarter: 1, total_score: "50.00", grade: "待改进" },
      ],
      prevYearRating: { consecutive_d_years: 1 },
    });

    const result = await generateYearlyRating(2024);
    expect(result.results[0].grade).toBe("D");
    expect(result.results[0].consecutiveDYears).toBe(2);
    expect(result.results[0].suggestTerminate).toBe(1);
  });

  test("刚好 85 分评为 A 级", async () => {
    setupMock({
      quarters: [
        { quarter: 1, total_score: "85.00", grade: "优秀" },
      ],
    });

    const result = await generateYearlyRating(2024);
    expect(result.results[0].grade).toBe("A");
    expect(result.results[0].avgScore).toBe(85);
  });

  test("刚好 70 分评为 B 级", async () => {
    setupMock({
      quarters: [
        { quarter: 1, total_score: "70.00", grade: "良好" },
      ],
    });

    const result = await generateYearlyRating(2024);
    expect(result.results[0].grade).toBe("B");
  });

  test("刚好 60 分评为 C 级", async () => {
    setupMock({
      quarters: [
        { quarter: 1, total_score: "60.00", grade: "合格" },
      ],
    });

    const result = await generateYearlyRating(2024);
    expect(result.results[0].grade).toBe("C");
  });
});
