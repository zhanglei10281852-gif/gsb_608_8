const { Router } = require("express");
const { pool } = require("../db");
const {
  calculateAssessment,
  generateQuarterlyAssessments,
  generateYearlyRating,
  getConfig,
} = require("../services/assessment");

const router = Router();

router.get("/calculate/:lawyerId", async (req, res) => {
  const { lawyerId } = req.params;
  const { year, quarter } = req.query;

  if (!year || !quarter) {
    return res.status(400).json({ error: "年份和季度为必填" });
  }

  const [[lawyer]] = await pool.execute("SELECT id FROM lawyers WHERE id = ?", [
    lawyerId,
  ]);
  if (!lawyer) return res.status(404).json({ error: "律师不存在" });

  try {
    const result = await calculateAssessment(
      parseInt(lawyerId),
      parseInt(year),
      parseInt(quarter),
    );
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/quarterly/generate", async (req, res) => {
  const { year, quarter } = req.body;
  if (!year || !quarter) {
    return res.status(400).json({ error: "年份和季度为必填" });
  }
  if (quarter < 1 || quarter > 4) {
    return res.status(400).json({ error: "季度必须为1-4" });
  }

  try {
    const result = await generateQuarterlyAssessments(
      parseInt(year),
      parseInt(quarter),
    );
    res.json({
      message: `季度考核生成完成，共${result.total}名律师`,
      data: result.results,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/quarterly", async (req, res) => {
  const {
    year,
    quarter,
    status,
    grade,
    lawyer_id,
    page = 1,
    size = 20,
  } = req.query;

  let conditions = [];
  let params = [];

  if (year) {
    conditions.push("q.year = ?");
    params.push(parseInt(year));
  }
  if (quarter) {
    conditions.push("q.quarter = ?");
    params.push(parseInt(quarter));
  }
  if (status) {
    conditions.push("q.status = ?");
    params.push(status);
  }
  if (grade) {
    conditions.push("q.grade = ?");
    params.push(grade);
  }
  if (lawyer_id) {
    conditions.push("q.lawyer_id = ?");
    params.push(parseInt(lawyer_id));
  }

  const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";

  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) as total FROM quarterly_assessments q${where}`,
    params,
  );

  const limit = parseInt(size);
  const offset = (parseInt(page) - 1) * limit;

  const [data] = await pool.query(
    `
    SELECT q.*, l.name as lawyer_name, l.license_no, l.firm
    FROM quarterly_assessments q 
    LEFT JOIN lawyers l ON q.lawyer_id = l.id
    ${where} 
    ORDER BY q.year DESC, q.quarter DESC, q.total_score DESC 
    LIMIT ${limit} OFFSET ${offset}
  `,
    params,
  );

  res.json({ total, page: parseInt(page), size: limit, data });
});

router.get("/quarterly/:id", async (req, res) => {
  const [[row]] = await pool.query(
    `
    SELECT q.*, l.name as lawyer_name, l.license_no, l.firm
    FROM quarterly_assessments q 
    LEFT JOIN lawyers l ON q.lawyer_id = l.id
    WHERE q.id = ?
  `,
    [req.params.id],
  );
  if (!row) return res.status(404).json({ error: "考核记录不存在" });
  res.json(row);
});

router.put("/quarterly/:id/confirm", async (req, res) => {
  const { confirmed_by, remark } = req.body;

  const [[assessment]] = await pool.execute(
    "SELECT * FROM quarterly_assessments WHERE id = ?",
    [req.params.id],
  );
  if (!assessment) return res.status(404).json({ error: "考核记录不存在" });
  if (assessment.status !== "待确认") {
    return res.status(400).json({ error: "只有待确认状态可以确认" });
  }

  await pool.execute(
    `UPDATE quarterly_assessments 
     SET status = '已确认', confirmed_by = ?, confirmed_at = NOW(), remark = ?
     WHERE id = ?`,
    [confirmed_by || "系统管理员", remark || null, req.params.id],
  );

  res.json({ message: "考核确认成功" });
});

router.put("/quarterly/:id/effective", async (req, res) => {
  const [[assessment]] = await pool.execute(
    "SELECT * FROM quarterly_assessments WHERE id = ?",
    [req.params.id],
  );
  if (!assessment) return res.status(404).json({ error: "考核记录不存在" });
  if (assessment.status !== "已确认") {
    return res.status(400).json({ error: "只有已确认状态可以生效" });
  }

  await pool.execute(
    "UPDATE quarterly_assessments SET status = '已生效' WHERE id = ?",
    [req.params.id],
  );

  res.json({ message: "考核已生效" });
});

router.post("/yearly/generate", async (req, res) => {
  const { year } = req.body;
  if (!year) {
    return res.status(400).json({ error: "年份为必填" });
  }

  try {
    const result = await generateYearlyRating(parseInt(year));
    res.json({
      message: `年度评级生成完成，共${result.total}名律师`,
      data: result.results,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/yearly", async (req, res) => {
  const { year, grade, lawyer_id, page = 1, size = 20 } = req.query;

  let conditions = [];
  let params = [];

  if (year) {
    conditions.push("y.year = ?");
    params.push(parseInt(year));
  }
  if (grade) {
    conditions.push("y.grade = ?");
    params.push(grade);
  }
  if (lawyer_id) {
    conditions.push("y.lawyer_id = ?");
    params.push(parseInt(lawyer_id));
  }

  const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";

  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) as total FROM yearly_ratings y${where}`,
    params,
  );

  const limit = parseInt(size);
  const offset = (parseInt(page) - 1) * limit;

  const [data] = await pool.query(
    `
    SELECT y.*, l.name as lawyer_name, l.license_no, l.firm
    FROM yearly_ratings y 
    LEFT JOIN lawyers l ON y.lawyer_id = l.id
    ${where} 
    ORDER BY y.year DESC, y.avg_score DESC 
    LIMIT ${limit} OFFSET ${offset}
  `,
    params,
  );

  res.json({ total, page: parseInt(page), size: limit, data });
});

router.get("/stats/rating-distribution", async (req, res) => {
  const { year, quarter, type = "quarterly" } = req.query;

  if (type === "yearly") {
    if (!year) return res.status(400).json({ error: "年份为必填" });
    const [data] = await pool.execute(
      `SELECT grade, COUNT(*) as count 
       FROM yearly_ratings 
       WHERE year = ? AND status = '已生效'
       GROUP BY grade 
       ORDER BY FIELD(grade, 'A', 'B', 'C', 'D')`,
      [year],
    );
    const grades = { A: 0, B: 0, C: 0, D: 0 };
    data.forEach((d) => (grades[d.grade] = d.count));
    res.json({ year: parseInt(year), type: "yearly", distribution: grades });
  } else {
    if (!year || !quarter)
      return res.status(400).json({ error: "年份和季度为必填" });
    const [data] = await pool.execute(
      `SELECT grade, COUNT(*) as count 
       FROM quarterly_assessments 
       WHERE year = ? AND quarter = ? AND status = '已生效'
       GROUP BY grade 
       ORDER BY FIELD(grade, '优秀', '良好', '合格', '待改进')`,
      [year, quarter],
    );
    const grades = { 优秀: 0, 良好: 0, 合格: 0, 待改进: 0 };
    data.forEach((d) => (grades[d.grade] = d.count));
    res.json({
      year: parseInt(year),
      quarter: parseInt(quarter),
      type: "quarterly",
      distribution: grades,
    });
  }
});

router.get("/stats/dimension-trend", async (req, res) => {
  const { start_year, start_quarter, end_year, end_quarter } = req.query;

  let conditions = ["status = '已生效'"];
  let params = [];

  if (start_year && start_quarter) {
    conditions.push("(year > ? OR (year = ? AND quarter >= ?))");
    params.push(
      parseInt(start_year),
      parseInt(start_year),
      parseInt(start_quarter),
    );
  }
  if (end_year && end_quarter) {
    conditions.push("(year < ? OR (year = ? AND quarter <= ?))");
    params.push(parseInt(end_year), parseInt(end_year), parseInt(end_quarter));
  }

  const where = " WHERE " + conditions.join(" AND ");

  const [data] = await pool.query(
    `
    SELECT year, quarter,
           AVG(case_count_score) as avg_case_count_score,
           AVG(quality_score) as avg_quality_score,
           AVG(efficiency_score) as avg_efficiency_score,
           AVG(attitude_score) as avg_attitude_score,
           AVG(total_score) as avg_total_score
    FROM quarterly_assessments
    ${where}
    GROUP BY year, quarter
    ORDER BY year, quarter
    LIMIT 20
  `,
    params,
  );

  res.json({ data });
});

router.get("/stats/ranking", async (req, res) => {
  const { year, quarter, type = "quarterly", limit = 10 } = req.query;

  if (type === "yearly") {
    if (!year) return res.status(400).json({ error: "年份为必填" });
    const [data] = await pool.query(
      `
      SELECT y.*, l.name as lawyer_name, l.firm
      FROM yearly_ratings y
      LEFT JOIN lawyers l ON y.lawyer_id = l.id
      WHERE y.year = ? AND y.status = '已生效'
      ORDER BY y.avg_score DESC
      LIMIT ?
      `,
      [parseInt(year), parseInt(limit)],
    );
    res.json({ year: parseInt(year), type: "yearly", data });
  } else {
    if (!year || !quarter)
      return res.status(400).json({ error: "年份和季度为必填" });
    const [data] = await pool.query(
      `
      SELECT q.*, l.name as lawyer_name, l.firm
      FROM quarterly_assessments q
      LEFT JOIN lawyers l ON q.lawyer_id = l.id
      WHERE q.year = ? AND q.quarter = ? AND q.status = '已生效'
      ORDER BY q.total_score DESC
      LIMIT ?
      `,
      [parseInt(year), parseInt(quarter), parseInt(limit)],
    );
    res.json({
      year: parseInt(year),
      quarter: parseInt(quarter),
      type: "quarterly",
      data,
    });
  }
});

router.get("/stats/need-improvement", async (req, res) => {
  const { year, quarter, type = "quarterly" } = req.query;

  if (type === "yearly") {
    if (!year) return res.status(400).json({ error: "年份为必填" });
    const [data] = await pool.query(
      `
      SELECT y.*, l.name as lawyer_name, l.firm, l.phone
      FROM yearly_ratings y
      LEFT JOIN lawyers l ON y.lawyer_id = l.id
      WHERE y.year = ? AND y.grade = 'D' AND y.status = '已生效'
      ORDER BY y.avg_score ASC
      `,
      [parseInt(year)],
    );
    res.json({
      year: parseInt(year),
      type: "yearly",
      count: data.length,
      data,
    });
  } else {
    if (!year || !quarter)
      return res.status(400).json({ error: "年份和季度为必填" });
    const [data] = await pool.query(
      `
      SELECT q.*, l.name as lawyer_name, l.firm, l.phone
      FROM quarterly_assessments q
      LEFT JOIN lawyers l ON q.lawyer_id = l.id
      WHERE q.year = ? AND q.quarter = ? AND q.grade = '待改进' AND q.status = '已生效'
      ORDER BY q.total_score ASC
      `,
      [parseInt(year), parseInt(quarter)],
    );
    res.json({
      year: parseInt(year),
      quarter: parseInt(quarter),
      type: "quarterly",
      count: data.length,
      data,
    });
  }
});

router.get("/config", async (_req, res) => {
  const [data] = await pool.execute("SELECT * FROM assessment_config");
  const config = {};
  data.forEach((item) => {
    config[item.config_key] = item.config_value;
  });
  res.json(config);
});

router.put("/config", async (req, res) => {
  const updates = req.body;
  const keys = Object.keys(updates);

  if (keys.length === 0) {
    return res.status(400).json({ error: "无配置项需要更新" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const key of keys) {
      await conn.execute(
        `INSERT INTO assessment_config (config_key, config_value) 
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
        [key, String(updates[key])],
      );
    }
    await conn.commit();
    res.json({ message: "配置更新成功" });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
