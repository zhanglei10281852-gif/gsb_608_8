const mockExecute = jest.fn();
jest.mock("../src/db", () => ({
  pool: {
    execute: mockExecute,
  },
}));

const assessment = require("../src/services/assessment");

function setupConfigMock(cfgOverrides = {}) {
  const defaults = {
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
  const cfg = { ...defaults, ...cfgOverrides };
  return (sql, params) => {
    if (sql.includes("assessment_config")) {
      return Promise.resolve([[{ config_value: cfg[params[0]] }]]);
    }
    return Promise.resolve([[]]);
  };
}

describe("考核评分引擎单元测试", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  describe("getQuarterRange - 季度时间区间计算（本地时间，避免UTC时区陷阱）", () => {
    test("Q1: 1月1日 00:00:00 ~ 3月31日 23:59:59", () => {
      const { startDate, endDate } = assessment.getQuarterRange(2024, 1);
      expect(startDate.getFullYear()).toBe(2024);
      expect(startDate.getMonth()).toBe(0);
      expect(startDate.getDate()).toBe(1);
      expect(startDate.getHours()).toBe(0);
      expect(endDate.getFullYear()).toBe(2024);
      expect(endDate.getMonth()).toBe(2);
      expect(endDate.getDate()).toBe(31);
      expect(endDate.getHours()).toBe(23);
      expect(endDate.getMinutes()).toBe(59);
      expect(endDate.getSeconds()).toBe(59);
    });

    test("Q2: 4月1日 ~ 6月30日", () => {
      const { startDate, endDate } = assessment.getQuarterRange(2024, 2);
      expect(startDate.getMonth()).toBe(3);
      expect(endDate.getMonth()).toBe(5);
      expect(endDate.getDate()).toBe(30);
    });

    test("Q3: 7月1日 ~ 9月30日", () => {
      const { startDate, endDate } = assessment.getQuarterRange(2024, 3);
      expect(startDate.getMonth()).toBe(6);
      expect(endDate.getMonth()).toBe(8);
      expect(endDate.getDate()).toBe(30);
    });

    test("Q4: 10月1日 ~ 12月31日", () => {
      const { startDate, endDate } = assessment.getQuarterRange(2024, 4);
      expect(startDate.getMonth()).toBe(9);
      expect(endDate.getMonth()).toBe(11);
      expect(endDate.getDate()).toBe(31);
    });
  });

  describe("calcCaseCountScore - 办案数量评分", () => {
    test("当季无已结案案件，得分为0", async () => {
      mockExecute
        .mockImplementationOnce(setupConfigMock())
        .mockResolvedValueOnce([[{ count: 0 }]]);

      const result = await assessment.calcCaseCountScore(1, 2024, 1);
      expect(result.count).toBe(0);
      expect(result.target).toBe(8);
      expect(result.score).toBe(0);
    });

    test("刚好完成目标8件，得分为100", async () => {
      mockExecute
        .mockImplementationOnce(setupConfigMock())
        .mockResolvedValueOnce([[{ count: 8 }]]);

      const result = await assessment.calcCaseCountScore(1, 2024, 1);
      expect(result.score).toBe(100);
    });

    test("完成4件，得分为50", async () => {
      mockExecute
        .mockImplementationOnce(setupConfigMock())
        .mockResolvedValueOnce([[{ count: 4 }]]);

      const result = await assessment.calcCaseCountScore(1, 2024, 1);
      expect(result.score).toBe(50);
    });

    test("超额完成（20件），分数封顶100", async () => {
      mockExecute
        .mockImplementationOnce(setupConfigMock())
        .mockResolvedValueOnce([[{ count: 20 }]]);

      const result = await assessment.calcCaseCountScore(1, 2024, 1);
      expect(result.score).toBe(100);
    });
  });

  describe("calcQualityScore - 办案质量评分", () => {
    test("当季无已结案案件：满意度默认3，投诉0，分数60", async () => {
      mockExecute
        .mockImplementationOnce(setupConfigMock())
        .mockResolvedValueOnce([[{ caseCount: 0 }]]);

      const result = await assessment.calcQualityScore(1, 2024, 1);
      expect(result.satisfaction).toBe(3);
      expect(result.complaintCount).toBe(0);
      expect(result.score).toBe(60);
    });

    test("有案件但无满意度评分：使用默认值3，分数60", async () => {
      mockExecute
        .mockImplementationOnce(setupConfigMock())
        .mockResolvedValueOnce([[{ caseCount: 5 }]])
        .mockResolvedValueOnce([[{ avgSatisfaction: null, ratedCount: 0 }]])
        .mockResolvedValueOnce([[{ complaintCount: 0 }]]);

      const result = await assessment.calcQualityScore(1, 2024, 1);
      expect(result.satisfaction).toBe(3);
      expect(result.score).toBe(60);
    });

    test("满意度5分且无投诉：满分100", async () => {
      mockExecute
        .mockImplementationOnce(setupConfigMock())
        .mockResolvedValueOnce([[{ caseCount: 5 }]])
        .mockResolvedValueOnce([[{ avgSatisfaction: 5, ratedCount: 5 }]])
        .mockResolvedValueOnce([[{ complaintCount: 0 }]]);

      const result = await assessment.calcQualityScore(1, 2024, 1);
      expect(result.satisfaction).toBe(5);
      expect(result.score).toBe(100);
    });

    test("满意度4分对应80分，无投诉", async () => {
      mockExecute
        .mockImplementationOnce(setupConfigMock())
        .mockResolvedValueOnce([[{ caseCount: 5 }]])
        .mockResolvedValueOnce([[{ avgSatisfaction: 4, ratedCount: 5 }]])
        .mockResolvedValueOnce([[{ complaintCount: 0 }]]);

      const result = await assessment.calcQualityScore(1, 2024, 1);
      expect(result.score).toBe(80);
    });

    test("1次投诉扣20分（满意度100 - 20 = 80）", async () => {
      mockExecute
        .mockImplementationOnce(setupConfigMock())
        .mockResolvedValueOnce([[{ caseCount: 5 }]])
        .mockResolvedValueOnce([[{ avgSatisfaction: 5, ratedCount: 5 }]])
        .mockResolvedValueOnce([[{ complaintCount: 1 }]]);

      const result = await assessment.calcQualityScore(1, 2024, 1);
      expect(result.complaintCount).toBe(1);
      expect(result.score).toBe(80);
    });

    test("5次投诉扣100分，分数为0（下限保护）", async () => {
      mockExecute
        .mockImplementationOnce(setupConfigMock())
        .mockResolvedValueOnce([[{ caseCount: 5 }]])
        .mockResolvedValueOnce([[{ avgSatisfaction: 5, ratedCount: 5 }]])
        .mockResolvedValueOnce([[{ complaintCount: 5 }]]);

      const result = await assessment.calcQualityScore(1, 2024, 1);
      expect(result.complaintCount).toBe(5);
      expect(result.score).toBe(0);
    });

    test("10次投诉扣200分，分数仍为0（不会为负）", async () => {
      mockExecute
        .mockImplementationOnce(setupConfigMock())
        .mockResolvedValueOnce([[{ caseCount: 5 }]])
        .mockResolvedValueOnce([[{ avgSatisfaction: 3, ratedCount: 5 }]])
        .mockResolvedValueOnce([[{ complaintCount: 10 }]]);

      const result = await assessment.calcQualityScore(1, 2024, 1);
      expect(result.score).toBe(0);
    });

    test("满意度1分（20分）+ 1次投诉（扣20）= 0分", async () => {
      mockExecute
        .mockImplementationOnce(setupConfigMock())
        .mockResolvedValueOnce([[{ caseCount: 5 }]])
        .mockResolvedValueOnce([[{ avgSatisfaction: 1, ratedCount: 5 }]])
        .mockResolvedValueOnce([[{ complaintCount: 1 }]]);

      const result = await assessment.calcQualityScore(1, 2024, 1);
      expect(result.score).toBe(0);
    });
  });

  describe("calcEfficiencyScore - 办案时效评分", () => {
    test("当季无已结案案件：平均周期0，分数60", async () => {
      mockExecute
        .mockImplementationOnce(setupConfigMock())
        .mockResolvedValueOnce([[{ caseCount: 0, avgCycle: null }]]);

      const result = await assessment.calcEfficiencyScore(1, 2024, 1);
      expect(result.caseCount).toBe(0);
      expect(result.avgCycleDays).toBe(0);
      expect(result.score).toBe(60);
      expect(result.standardDays).toBe(60);
    });

    test("刚好60天标准周期结案：得分100", async () => {
      mockExecute
        .mockImplementationOnce(setupConfigMock())
        .mockResolvedValueOnce([[{ caseCount: 5, avgCycle: 60 }]]);

      const result = await assessment.calcEfficiencyScore(1, 2024, 1);
      expect(result.avgCycleDays).toBe(60);
      expect(result.score).toBe(100);
    });

    test("30天快速结案：时效分200但封顶100", async () => {
      mockExecute
        .mockImplementationOnce(setupConfigMock())
        .mockResolvedValueOnce([[{ caseCount: 5, avgCycle: 30 }]]);

      const result = await assessment.calcEfficiencyScore(1, 2024, 1);
      expect(result.avgCycleDays).toBe(30);
      expect(result.score).toBe(100);
    });

    test("120天结案：时效得分50", async () => {
      mockExecute
        .mockImplementationOnce(setupConfigMock())
        .mockResolvedValueOnce([[{ caseCount: 5, avgCycle: 120 }]]);

      const result = await assessment.calcEfficiencyScore(1, 2024, 1);
      expect(result.avgCycleDays).toBe(120);
      expect(result.score).toBe(50);
    });

    test("avgCycle为null时回退用标准天数60", async () => {
      mockExecute
        .mockImplementationOnce(setupConfigMock())
        .mockResolvedValueOnce([[{ caseCount: 3, avgCycle: null }]]);

      const result = await assessment.calcEfficiencyScore(1, 2024, 1);
      expect(result.avgCycleDays).toBe(60);
      expect(result.score).toBe(100);
    });
  });

  describe("calcAttitudeScore - 服务态度评分", () => {
    test("无咨询记录：咨询量0，评分用默认3，得分30", async () => {
      mockExecute
        .mockResolvedValueOnce([[{ consultCount: 0 }]])
        .mockResolvedValueOnce([[{ avgRating: null, ratedCount: 0 }]]);

      const result = await assessment.calcAttitudeScore(1, 2024, 1);
      expect(result.consultationCount).toBe(0);
      expect(result.avgRating).toBe(3);
      expect(result.score).toBe(30);
    });

    test("20次咨询达标，全5分好评：满分100", async () => {
      mockExecute
        .mockResolvedValueOnce([[{ consultCount: 20 }]])
        .mockResolvedValueOnce([[{ avgRating: 5, ratedCount: 20 }]]);

      const result = await assessment.calcAttitudeScore(1, 2024, 1);
      expect(result.consultationCount).toBe(20);
      expect(result.avgRating).toBe(5);
      expect(result.score).toBe(100);
    });

    test("10次咨询，无评分（默认3分）：数量分50 + 评分分60 加权=55", async () => {
      mockExecute
        .mockResolvedValueOnce([[{ consultCount: 10 }]])
        .mockResolvedValueOnce([[{ avgRating: null, ratedCount: 0 }]]);

      const result = await assessment.calcAttitudeScore(1, 2024, 1);
      expect(result.consultationCount).toBe(10);
      expect(result.avgRating).toBe(3);
      expect(result.score).toBe(55);
    });

    test("40次咨询超额（数量分封顶100），平均4分：100*0.5 + 80*0.5 = 90", async () => {
      mockExecute
        .mockResolvedValueOnce([[{ consultCount: 40 }]])
        .mockResolvedValueOnce([[{ avgRating: 4, ratedCount: 30 }]]);

      const result = await assessment.calcAttitudeScore(1, 2024, 1);
      expect(result.consultationCount).toBe(40);
      expect(result.avgRating).toBe(4);
      expect(result.score).toBe(90);
    });
  });

  describe("calculateAssessment - 季度综合考核（覆盖评级边界）", () => {
    function mockForCalcAssessment(overrides = {}) {
      const data = {
        caseCount: 8,
        caseCountForQuality: 8,
        avgSatisfaction: 5,
        ratedCount: 8,
        complaintCount: 0,
        effCaseCount: 8,
        avgCycle: 60,
        consultCount: 20,
        avgRating: 5,
        ratedConsultCount: 20,
        ...overrides,
      };

      return (sql, params) => {
        if (sql.includes("assessment_config")) {
          return setupConfigMock()(sql, params);
        }
        if (sql.includes("COUNT(*) as count FROM cases") && !sql.includes("caseCount")) {
          return Promise.resolve([[{ count: data.caseCount }]]);
        }
        if (sql.includes("COUNT(*) as caseCount FROM cases")) {
          return Promise.resolve([[{ caseCount: data.caseCountForQuality }]]);
        }
        if (sql.includes("AVG(satisfaction_score)")) {
          return Promise.resolve([[{ avgSatisfaction: data.avgSatisfaction, ratedCount: data.ratedCount }]]);
        }
        if (sql.includes("COUNT(*) as complaintCount")) {
          return Promise.resolve([[{ complaintCount: data.complaintCount }]]);
        }
        if (sql.includes("AVG(TIMESTAMPDIFF")) {
          return Promise.resolve([[{ caseCount: data.effCaseCount, avgCycle: data.avgCycle }]]);
        }
        if (sql.includes("COUNT(*) as consultCount")) {
          return Promise.resolve([[{ consultCount: data.consultCount }]]);
        }
        if (sql.includes("AVG(rating)")) {
          return Promise.resolve([[{ avgRating: data.avgRating, ratedCount: data.ratedConsultCount }]]);
        }
        return Promise.resolve([[]]);
      };
    }

    test("全满分场景：综合分100，评级优秀", async () => {
      mockExecute.mockImplementation(mockForCalcAssessment());
      const result = await assessment.calculateAssessment(1, 2024, 1);
      expect(result.totalScore).toBe(100);
      expect(result.grade).toBe("优秀");
    });

    test("综合分刚好85分边界值，评级优秀", async () => {
      mockExecute.mockImplementation(mockForCalcAssessment({ complaintCount: 1 }));
      const result = await assessment.calculateAssessment(1, 2024, 1);
      expect(result.totalScore).toBe(94);
      expect(result.grade).toBe("优秀");
    });

    test("综合分70-84区间，评级良好（82.5分）", async () => {
      mockExecute.mockImplementation(mockForCalcAssessment({
        caseCount: 6,
        caseCountForQuality: 8,
        avgSatisfaction: 4,
        ratedCount: 8,
        complaintCount: 0,
        avgCycle: 60,
        consultCount: 16,
        avgRating: 4,
        ratedConsultCount: 16,
      }));
      const result = await assessment.calculateAssessment(1, 2024, 1);
      expect(result.totalScore).toBe(82.5);
      expect(result.grade).toBe("良好");
    });

    test("综合分刚好60分边界值，评级合格", async () => {
      mockExecute.mockImplementation(mockForCalcAssessment({
        caseCount: 8,
        caseCountForQuality: 8,
        avgSatisfaction: 3,
        ratedCount: 8,
        complaintCount: 0,
        effCaseCount: 8,
        avgCycle: 150,
        consultCount: 0,
        avgRating: 2,
        ratedConsultCount: 5,
      }));
      const result = await assessment.calculateAssessment(1, 2024, 1);
      expect(result.totalScore).toBe(60);
      expect(result.grade).toBe("合格");
    });

    test("综合分低于60，评级待改进", async () => {
      mockExecute.mockImplementation(mockForCalcAssessment({
        caseCount: 0,
        caseCountForQuality: 8,
        avgSatisfaction: 1,
        ratedCount: 8,
        complaintCount: 5,
        effCaseCount: 0,
        consultCount: 0,
        avgRating: null,
        ratedConsultCount: 0,
      }));
      const result = await assessment.calculateAssessment(1, 2024, 1);
      expect(result.totalScore).toBe(0 * 0.3 + 0 * 0.3 + 60 * 0.2 + 30 * 0.2);
      expect(result.grade).toBe("待改进");
    });
  });

  describe("generateYearlyRating - 年度评级业务逻辑", () => {
    function mockForYearly(quarters, prevConsecutiveD = null, existing = false) {
      const mocks = [
        [[{ id: 1 }]],
        [quarters],
      ];
      if (quarters.length > 0) {
        const avg = quarters.reduce((s, q) => s + q.total_score, 0) / quarters.length;
        if (avg < 60) {
          mocks.push(prevConsecutiveD !== null ? [[{ consecutive_d_years: prevConsecutiveD }]] : [[]]);
        }
      }
      mocks.push(existing ? [[{ id: 1 }]] : [[]]);
      mocks.push([{ insertId: 1 }]);
      return mocks.map(m => () => Promise.resolve(m));
    }

    test("年度平均分88.75，评级A，subsidyIncrease=1补贴上浮", async () => {
      const qs = [
        { quarter: 1, total_score: 90, grade: "优秀" },
        { quarter: 2, total_score: 88, grade: "优秀" },
        { quarter: 3, total_score: 85, grade: "优秀" },
        { quarter: 4, total_score: 92, grade: "优秀" },
      ];
      mockExecute.mockImplementation((() => {
        const mocks = [
          [[{ id: 1 }]], [qs], [[]], [{ insertId: 1 }]
        ];
        let i = 0;
        return () => Promise.resolve(mocks[i++]);
      })());

      const result = await assessment.generateYearlyRating(2024);
      const r = result.results[0];
      expect(r.avgScore).toBe(88.75);
      expect(r.grade).toBe("A");
      expect(r.subsidyIncrease).toBe(1);
      expect(r.suggestTerminate).toBe(0);
    });

    test("年度平均分76.5，评级B", async () => {
      const qs = [
        { quarter: 1, total_score: 75, grade: "良好" },
        { quarter: 2, total_score: 78, grade: "良好" },
      ];
      mockExecute.mockImplementation((() => {
        const mocks = [[[{ id: 2 }]], [qs], [[]], [{ insertId: 1 }]];
        let i = 0;
        return () => Promise.resolve(mocks[i++]);
      })());

      const result = await assessment.generateYearlyRating(2024);
      expect(result.results[0].avgScore).toBe(76.5);
      expect(result.results[0].grade).toBe("B");
      expect(result.results[0].subsidyIncrease).toBe(0);
    });

    test("年度平均分65，评级C", async () => {
      const qs = [
        { quarter: 1, total_score: 62, grade: "合格" },
        { quarter: 2, total_score: 68, grade: "合格" },
      ];
      mockExecute.mockImplementation((() => {
        const mocks = [[[{ id: 3 }]], [qs], [[]], [{ insertId: 1 }]];
        let i = 0;
        return () => Promise.resolve(mocks[i++]);
      })());

      const result = await assessment.generateYearlyRating(2024);
      expect(result.results[0].avgScore).toBe(65);
      expect(result.results[0].grade).toBe("C");
    });

    test("年度平均分52.5，评级D，首次D级consecutiveDYears=1，不建议解约", async () => {
      const qs = [
        { quarter: 1, total_score: 50, grade: "待改进" },
        { quarter: 2, total_score: 55, grade: "待改进" },
      ];
      mockExecute.mockImplementation((() => {
        const mocks = [
          [[{ id: 4 }]], [qs],
          [[]],
          [[]], [{ insertId: 1 }]
        ];
        let i = 0;
        return () => Promise.resolve(mocks[i++]);
      })());

      const result = await assessment.generateYearlyRating(2024);
      const r = result.results[0];
      expect(r.avgScore).toBe(52.5);
      expect(r.grade).toBe("D");
      expect(r.consecutiveDYears).toBe(1);
      expect(r.suggestTerminate).toBe(0);
    });

    test("连续两年D级（上年consecutive_d_years=1），consecutiveDYears=2，suggestTerminate=1建议解约", async () => {
      const qs = [{ quarter: 1, total_score: 50, grade: "待改进" }];
      mockExecute.mockImplementation((() => {
        const mocks = [
          [[{ id: 5 }]], [qs],
          [[{ consecutive_d_years: 1 }]],
          [[]], [{ insertId: 1 }]
        ];
        let i = 0;
        return () => Promise.resolve(mocks[i++]);
      })());

      const result = await assessment.generateYearlyRating(2024);
      const r = result.results[0];
      expect(r.grade).toBe("D");
      expect(r.consecutiveDYears).toBe(2);
      expect(r.suggestTerminate).toBe(1);
    });

    test("年度评级边界：avgScore=85 刚好A级，补贴上浮", async () => {
      const qs = [
        { quarter: 1, total_score: 85, grade: "优秀" },
        { quarter: 2, total_score: 85, grade: "优秀" },
      ];
      mockExecute.mockImplementation((() => {
        const mocks = [[[{ id: 6 }]], [qs], [[]], [{ insertId: 1 }]];
        let i = 0;
        return () => Promise.resolve(mocks[i++]);
      })());

      const result = await assessment.generateYearlyRating(2024);
      expect(result.results[0].avgScore).toBe(85);
      expect(result.results[0].grade).toBe("A");
      expect(result.results[0].subsidyIncrease).toBe(1);
    });

    test("年度评级边界：avgScore=70 刚好B级", async () => {
      const qs = [{ quarter: 1, total_score: 70, grade: "良好" }];
      mockExecute.mockImplementation((() => {
        const mocks = [[[{ id: 7 }]], [qs], [[]], [{ insertId: 1 }]];
        let i = 0;
        return () => Promise.resolve(mocks[i++]);
      })());

      const result = await assessment.generateYearlyRating(2024);
      expect(result.results[0].avgScore).toBe(70);
      expect(result.results[0].grade).toBe("B");
    });

    test("年度评级边界：avgScore=60 刚好C级", async () => {
      const qs = [{ quarter: 1, total_score: 60, grade: "合格" }];
      mockExecute.mockImplementation((() => {
        const mocks = [[[{ id: 8 }]], [qs], [[]], [{ insertId: 1 }]];
        let i = 0;
        return () => Promise.resolve(mocks[i++]);
      })());

      const result = await assessment.generateYearlyRating(2024);
      expect(result.results[0].avgScore).toBe(60);
      expect(result.results[0].grade).toBe("C");
    });

    test("无任何已生效季度考核时，avgScore=0，grade=C，各季度分null", async () => {
      mockExecute.mockImplementation((() => {
        const mocks = [[[{ id: 9 }]], [[]], [[]], [{ insertId: 1 }]];
        let i = 0;
        return () => Promise.resolve(mocks[i++]);
      })());

      const result = await assessment.generateYearlyRating(2024);
      const r = result.results[0];
      expect(r.avgScore).toBe(0);
      expect(r.grade).toBe("C");
      expect(r.q1Score).toBeNull();
      expect(r.q2Score).toBeNull();
      expect(r.q3Score).toBeNull();
      expect(r.q4Score).toBeNull();
      expect(r.subsidyIncrease).toBe(0);
      expect(r.suggestTerminate).toBe(0);
    });

    test("D级后下一年度回到A级，consecutiveDYears重置为0", async () => {
      const qs = [
        { quarter: 1, total_score: 90, grade: "优秀" },
        { quarter: 2, total_score: 90, grade: "优秀" },
      ];
      mockExecute.mockImplementation((() => {
        const mocks = [[[{ id: 11 }]], [qs], [[]], [{ insertId: 1 }]];
        let i = 0;
        return () => Promise.resolve(mocks[i++]);
      })());

      const result = await assessment.generateYearlyRating(2025);
      const r = result.results[0];
      expect(r.grade).toBe("A");
      expect(r.consecutiveDYears).toBe(0);
      expect(r.subsidyIncrease).toBe(1);
    });
  });

  describe("generateQuarterlyAssessments - 批量生成季度考核", () => {
    test("无律师时返回0条", async () => {
      mockExecute.mockResolvedValueOnce([[]]);
      const result = await assessment.generateQuarterlyAssessments(2024, 1);
      expect(result.total).toBe(0);
      expect(result.results).toHaveLength(0);
    });

    test("2名律师：一名INSERT新记录，一名UPDATE已有记录", async () => {
      const existingSet = new Set([102]);
      const cfg = {
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

      mockExecute.mockImplementation((sql, params) => {
        if (sql.includes("FROM lawyers")) return Promise.resolve([[{ id: 101 }, { id: 102 }]]);
        if (sql.includes("assessment_config")) return Promise.resolve([[{ config_value: cfg[params[0]] }]]);
        if (sql.includes("COUNT(*) as count FROM cases") && !sql.includes("caseCount")) return Promise.resolve([[{ count: 8 }]]);
        if (sql.includes("COUNT(*) as caseCount FROM cases")) return Promise.resolve([[{ caseCount: 8 }]]);
        if (sql.includes("AVG(satisfaction_score)")) return Promise.resolve([[{ avgSatisfaction: 5, ratedCount: 8 }]]);
        if (sql.includes("COUNT(*) as complaintCount")) return Promise.resolve([[{ complaintCount: 0 }]]);
        if (sql.includes("AVG(TIMESTAMPDIFF")) return Promise.resolve([[{ caseCount: 8, avgCycle: 60 }]]);
        if (sql.includes("COUNT(*) as consultCount")) return Promise.resolve([[{ consultCount: 20 }]]);
        if (sql.includes("AVG(rating)")) return Promise.resolve([[{ avgRating: 5, ratedCount: 20 }]]);
        if (sql.includes("SELECT id FROM quarterly_assessments")) {
          const lid = params[0];
          return Promise.resolve([existingSet.has(lid) ? [{ id: 1 }] : []]);
        }
        if (sql.includes("UPDATE quarterly_assessments")) return Promise.resolve([{ affectedRows: 1 }]);
        if (sql.includes("INSERT INTO quarterly_assessments")) return Promise.resolve([{ insertId: 1 }]);
        return Promise.resolve([[]]);
      });

      const result = await assessment.generateQuarterlyAssessments(2024, 1);
      expect(result.total).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].lawyerId).toBe(101);
      expect(result.results[1].lawyerId).toBe(102);
      expect(result.results[0].grade).toBe("优秀");
      expect(result.results[1].grade).toBe("优秀");
    });
  });
});
