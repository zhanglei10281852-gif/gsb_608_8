const { pool } = require("../db");

async function getConfig(key, defaultValue) {
  const [[row]] = await pool.execute(
    "SELECT config_value FROM assessment_config WHERE config_key = ?",
    [key],
  );
  return row ? row.config_value : defaultValue;
}

function getQuarterRange(year, quarter) {
  const startMonth = (quarter - 1) * 3;
  const startDate = new Date(year, startMonth, 1);
  const endMonth = startMonth + 3;
  const endDate = new Date(year, endMonth, 0, 23, 59, 59);
  return { startDate, endDate };
}

async function calcCaseCountScore(lawyerId, year, quarter) {
  const { startDate, endDate } = getQuarterRange(year, quarter);
  const target = parseInt(await getConfig("quarterly_case_target", "8"));

  const [[{ count }]] = await pool.execute(
    `SELECT COUNT(*) as count FROM cases 
     WHERE lawyer_id = ? AND status = '已结案' 
     AND closed_at >= ? AND closed_at <= ?`,
    [lawyerId, startDate, endDate],
  );

  const score = Math.min(100, (count / target) * 100);
  return { count, score: Math.round(score * 100) / 100, target };
}

async function calcQualityScore(lawyerId, year, quarter) {
  const { startDate, endDate } = getQuarterRange(year, quarter);
  const defaultSatisfaction = parseFloat(
    await getConfig("default_satisfaction", "3"),
  );

  const [[{ caseCount }]] = await pool.execute(
    `SELECT COUNT(*) as caseCount FROM cases 
     WHERE lawyer_id = ? AND status = '已结案' 
     AND closed_at >= ? AND closed_at <= ?`,
    [lawyerId, startDate, endDate],
  );

  if (caseCount === 0) {
    return { satisfaction: defaultSatisfaction, complaintCount: 0, score: 60 };
  }

  const [[{ avgSatisfaction, ratedCount }]] = await pool.execute(
    `SELECT AVG(satisfaction_score) as avgSatisfaction, 
            COUNT(satisfaction_score) as ratedCount 
     FROM cases 
     WHERE lawyer_id = ? AND status = '已结案' 
     AND closed_at >= ? AND closed_at <= ?`,
    [lawyerId, startDate, endDate],
  );

  const finalSatisfaction =
    ratedCount > 0 ? avgSatisfaction : defaultSatisfaction;

  const [[{ complaintCount }]] = await pool.execute(
    `SELECT COUNT(*) as complaintCount FROM complaints 
     WHERE lawyer_id = ? AND status != '已撤销'
     AND created_at >= ? AND created_at <= ?`,
    [lawyerId, startDate, endDate],
  );

  const satisfactionScore = (finalSatisfaction / 5) * 100;

  let complaintDeduction = 0;
  if (complaintCount > 0) {
    complaintDeduction = Math.min(100, complaintCount * 20);
  }

  const qualityScore = Math.max(
    0,
    Math.min(100, satisfactionScore - complaintDeduction),
  );

  return {
    satisfaction: Math.round(finalSatisfaction * 100) / 100,
    complaintCount,
    score: Math.round(qualityScore * 100) / 100,
  };
}

async function calcEfficiencyScore(lawyerId, year, quarter) {
  const { startDate, endDate } = getQuarterRange(year, quarter);
  const standardDays = parseFloat(await getConfig("standard_cycle_days", "60"));

  const [[result]] = await pool.execute(
    `SELECT 
       COUNT(*) as caseCount,
       AVG(TIMESTAMPDIFF(DAY, created_at, closed_at)) as avgCycle
     FROM cases 
     WHERE lawyer_id = ? AND status = '已结案' 
     AND closed_at >= ? AND closed_at <= ?`,
    [lawyerId, startDate, endDate],
  );

  if (result.caseCount === 0) {
    return { avgCycleDays: 0, caseCount: 0, score: 60, standardDays };
  }

  const avgCycle = result.avgCycle || standardDays;
  const score = Math.min(100, (standardDays / avgCycle) * 100);

  return {
    avgCycleDays: Math.round(avgCycle * 100) / 100,
    caseCount: result.caseCount,
    score: Math.round(score * 100) / 100,
    standardDays,
  };
}

async function calcAttitudeScore(lawyerId, year, quarter) {
  const { startDate, endDate } = getQuarterRange(year, quarter);

  const [[{ consultCount }]] = await pool.execute(
    `SELECT COUNT(*) as consultCount FROM consultations 
     WHERE lawyer_id = ? AND created_at >= ? AND created_at <= ?`,
    [lawyerId, startDate, endDate],
  );

  const [[{ avgRating, ratedCount }]] = await pool.execute(
    `SELECT AVG(rating) as avgRating, COUNT(rating) as ratedCount 
     FROM consultations 
     WHERE lawyer_id = ? AND rating IS NOT NULL
     AND created_at >= ? AND created_at <= ?`,
    [lawyerId, startDate, endDate],
  );

  const targetConsult = 20;
  const quantityScore = Math.min(100, (consultCount / targetConsult) * 100);

  const baseRating = 3;
  const finalRating = ratedCount > 0 ? avgRating : baseRating;
  const ratingScore = (finalRating / 5) * 100;

  const score = quantityScore * 0.5 + ratingScore * 0.5;

  return {
    consultationCount: consultCount,
    avgRating: Math.round(finalRating * 100) / 100,
    score: Math.round(score * 100) / 100,
  };
}

function getGrade(
  totalScore,
  excellentThreshold,
  goodThreshold,
  passThreshold,
) {
  if (totalScore >= excellentThreshold) return "优秀";
  if (totalScore >= goodThreshold) return "良好";
  if (totalScore >= passThreshold) return "合格";
  return "待改进";
}

async function calculateAssessment(lawyerId, year, quarter) {
  const [caseCountResult, qualityResult, efficiencyResult, attitudeResult] =
    await Promise.all([
      calcCaseCountScore(lawyerId, year, quarter),
      calcQualityScore(lawyerId, year, quarter),
      calcEfficiencyScore(lawyerId, year, quarter),
      calcAttitudeScore(lawyerId, year, quarter),
    ]);

  const weightCaseCount = parseFloat(
    await getConfig("weight_case_count", "0.3"),
  );
  const weightQuality = parseFloat(await getConfig("weight_quality", "0.3"));
  const weightEfficiency = parseFloat(
    await getConfig("weight_efficiency", "0.2"),
  );
  const weightAttitude = parseFloat(await getConfig("weight_attitude", "0.2"));

  const totalScore =
    caseCountResult.score * weightCaseCount +
    qualityResult.score * weightQuality +
    efficiencyResult.score * weightEfficiency +
    attitudeResult.score * weightAttitude;

  const excellentThreshold = parseFloat(
    await getConfig("excellent_threshold", "85"),
  );
  const goodThreshold = parseFloat(await getConfig("good_threshold", "70"));
  const passThreshold = parseFloat(await getConfig("pass_threshold", "60"));

  const grade = getGrade(
    Math.round(totalScore * 100) / 100,
    excellentThreshold,
    goodThreshold,
    passThreshold,
  );

  return {
    lawyerId,
    year,
    quarter,
    caseCount: caseCountResult.count,
    caseCountScore: caseCountResult.score,
    caseCountTarget: caseCountResult.target,
    qualityScore: qualityResult.score,
    satisfaction: qualityResult.satisfaction,
    complaintCount: qualityResult.complaintCount,
    avgCycleDays: efficiencyResult.avgCycleDays,
    efficiencyScore: efficiencyResult.score,
    standardCycleDays: efficiencyResult.standardDays,
    consultationCount: attitudeResult.consultationCount,
    avgRating: attitudeResult.avgRating,
    attitudeScore: attitudeResult.score,
    totalScore: Math.round(totalScore * 100) / 100,
    grade,
  };
}

async function generateQuarterlyAssessments(year, quarter) {
  const [lawyers] = await pool.execute(
    "SELECT id FROM lawyers WHERE status IN ('可接案', '案件中')",
  );

  const results = [];
  for (const lawyer of lawyers) {
    const assessment = await calculateAssessment(lawyer.id, year, quarter);

    const [existing] = await pool.execute(
      "SELECT id FROM quarterly_assessments WHERE lawyer_id = ? AND year = ? AND quarter = ?",
      [lawyer.id, year, quarter],
    );

    if (existing.length > 0) {
      await pool.execute(
        `UPDATE quarterly_assessments SET 
           case_count = ?, case_count_score = ?, quality_score = ?,
           avg_cycle_days = ?, efficiency_score = ?, 
           consultation_count = ?, attitude_score = ?,
           total_score = ?, grade = ?, status = '待确认'
         WHERE lawyer_id = ? AND year = ? AND quarter = ?`,
        [
          assessment.caseCount,
          assessment.caseCountScore,
          assessment.qualityScore,
          assessment.avgCycleDays,
          assessment.efficiencyScore,
          assessment.consultationCount,
          assessment.attitudeScore,
          assessment.totalScore,
          assessment.grade,
          lawyer.id,
          year,
          quarter,
        ],
      );
    } else {
      await pool.execute(
        `INSERT INTO quarterly_assessments 
           (lawyer_id, year, quarter, case_count, case_count_score, 
            quality_score, avg_cycle_days, efficiency_score, 
            consultation_count, attitude_score, total_score, grade, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          lawyer.id,
          year,
          quarter,
          assessment.caseCount,
          assessment.caseCountScore,
          assessment.qualityScore,
          assessment.avgCycleDays,
          assessment.efficiencyScore,
          assessment.consultationCount,
          assessment.attitudeScore,
          assessment.totalScore,
          assessment.grade,
          "待确认",
        ],
      );
    }

    results.push(assessment);
  }

  return { total: lawyers.length, results };
}

async function generateYearlyRating(year) {
  const [lawyers] = await pool.execute("SELECT id FROM lawyers");

  const results = [];
  for (const lawyer of lawyers) {
    const [quarters] = await pool.execute(
      `SELECT quarter, total_score, grade 
       FROM quarterly_assessments 
       WHERE lawyer_id = ? AND year = ? AND status = '已生效'
       ORDER BY quarter`,
      [lawyer.id, year],
    );

    const qScores = [null, null, null, null];
    let totalScore = 0;
    let validCount = 0;

    for (const q of quarters) {
      qScores[q.quarter - 1] = q.total_score;
      totalScore += parseFloat(q.total_score);
      validCount++;
    }

    const avgScore = validCount > 0 ? totalScore / validCount : 0;

    let grade = "C";
    if (validCount > 0) {
      if (avgScore >= 85) grade = "A";
      else if (avgScore >= 70) grade = "B";
      else if (avgScore >= 60) grade = "C";
      else grade = "D";
    }

    let consecutiveD = 0;
    if (grade === "D") {
      const [[prevYear]] = await pool.execute(
        "SELECT consecutive_d_years FROM yearly_ratings WHERE lawyer_id = ? AND year = ?",
        [lawyer.id, year - 1],
      );
      consecutiveD = (prevYear?.consecutive_d_years || 0) + 1;
    }

    const suggestTerminate = consecutiveD >= 2 ? 1 : 0;
    const subsidyIncrease = grade === "A" ? 1 : 0;

    const [existing] = await pool.execute(
      "SELECT id FROM yearly_ratings WHERE lawyer_id = ? AND year = ?",
      [lawyer.id, year],
    );

    if (existing.length > 0) {
      await pool.execute(
        `UPDATE yearly_ratings SET 
           q1_score = ?, q2_score = ?, q3_score = ?, q4_score = ?,
           avg_score = ?, grade = ?, consecutive_d_years = ?, 
           suggest_terminate = ?, subsidy_increase = ?, status = '待确认'
         WHERE lawyer_id = ? AND year = ?`,
        [
          qScores[0],
          qScores[1],
          qScores[2],
          qScores[3],
          Math.round(avgScore * 100) / 100,
          grade,
          consecutiveD,
          suggestTerminate,
          subsidyIncrease,
          lawyer.id,
          year,
        ],
      );
    } else {
      await pool.execute(
        `INSERT INTO yearly_ratings 
           (lawyer_id, year, q1_score, q2_score, q3_score, q4_score, 
            avg_score, grade, consecutive_d_years, suggest_terminate, subsidy_increase, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          lawyer.id,
          year,
          qScores[0],
          qScores[1],
          qScores[2],
          qScores[3],
          Math.round(avgScore * 100) / 100,
          grade,
          consecutiveD,
          suggestTerminate,
          subsidyIncrease,
          "待确认",
        ],
      );
    }

    results.push({
      lawyerId: lawyer.id,
      year,
      q1Score: qScores[0],
      q2Score: qScores[1],
      q3Score: qScores[2],
      q4Score: qScores[3],
      avgScore: Math.round(avgScore * 100) / 100,
      grade,
      consecutiveDYears: consecutiveD,
      suggestTerminate,
      subsidyIncrease,
    });
  }

  return { total: lawyers.length, results };
}

module.exports = {
  getConfig,
  getQuarterRange,
  calcCaseCountScore,
  calcQualityScore,
  calcEfficiencyScore,
  calcAttitudeScore,
  calculateAssessment,
  generateQuarterlyAssessments,
  generateYearlyRating,
};
