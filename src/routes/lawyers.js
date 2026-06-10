const { Router } = require("express");
const { pool } = require("../db");
const router = Router();

router.post("/", async (req, res) => {
  const { name, license_no, phone, firm, speciality, subsidy_base } = req.body;
  if (!name || !license_no || !firm) {
    return res.status(400).json({ error: "姓名、执业证号、律所为必填" });
  }
  try {
    const [result] = await pool.execute(
      "INSERT INTO lawyers (name, license_no, phone, firm, speciality, subsidy_base) VALUES (?,?,?,?,?,?)",
      [
        name,
        license_no,
        phone || null,
        firm,
        speciality || null,
        subsidy_base || 0,
      ],
    );
    res.status(201).json({ id: result.insertId, message: "律师录入成功" });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY")
      return res.status(409).json({ error: "执业证号已存在" });
    res.status(500).json({ error: e.message });
  }
});

router.get("/", async (req, res) => {
  const { status, page = 1, size = 20, sort_by } = req.query;
  let where = "";
  let params = [];
  if (status) {
    where = " WHERE l.status = ?";
    params.push(status);
  }
  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) as total FROM lawyers l${where}`,
    params,
  );
  const limit = parseInt(size);
  const offset = (parseInt(page) - 1) * limit;

  let orderBy = "l.case_count ASC";
  if (sort_by === "priority") {
    orderBy = `
      (SELECT q.grade FROM quarterly_assessments q 
       WHERE q.lawyer_id = l.id AND q.status = '已生效'
       ORDER BY q.year DESC, q.quarter DESC LIMIT 1) = '待改进' ASC,
      l.case_count ASC
    `;
  }

  const [data] = await pool.query(
    `SELECT l.*,
      (SELECT q.grade FROM quarterly_assessments q 
       WHERE q.lawyer_id = l.id AND q.status = '已生效'
       ORDER BY q.year DESC, q.quarter DESC LIMIT 1) as last_grade,
      (SELECT q.total_score FROM quarterly_assessments q 
       WHERE q.lawyer_id = l.id AND q.status = '已生效'
       ORDER BY q.year DESC, q.quarter DESC LIMIT 1) as last_score
     FROM lawyers l${where} 
     ORDER BY ${orderBy} 
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  res.json({ total, page: parseInt(page), size: limit, data });
});

router.get("/:id/dashboard", async (req, res) => {
  const lawyerId = req.params.id;

  const [[lawyer]] = await pool.execute("SELECT * FROM lawyers WHERE id = ?", [
    lawyerId,
  ]);
  if (!lawyer) return res.status(404).json({ error: "律师不存在" });

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentQuarter = Math.floor(now.getMonth() / 3) + 1;

  const quarterStart = new Date(currentYear, (currentQuarter - 1) * 3, 1);

  const [[{ closedCount }]] = await pool.execute(
    `SELECT COUNT(*) as closedCount FROM cases 
     WHERE lawyer_id = ? AND status = '已结案' AND closed_at >= ?`,
    [lawyerId, quarterStart],
  );

  const [[{ processingCount }]] = await pool.execute(
    `SELECT COUNT(*) as processingCount FROM cases 
     WHERE lawyer_id = ? AND status IN ('已指派','办理中')`,
    [lawyerId],
  );

  const [processingCases] = await pool.query(
    `SELECT id, case_no, case_type, status, created_at 
     FROM cases 
     WHERE lawyer_id = ? AND status IN ('已指派','办理中')
     ORDER BY created_at DESC`,
    [lawyerId],
  );

  const quarterTarget = 8;
  const caseCountProgress = Math.min(100, (closedCount / quarterTarget) * 100);

  const [history] = await pool.query(
    `SELECT year, quarter, total_score, grade, 
            case_count_score, quality_score, efficiency_score, attitude_score
     FROM quarterly_assessments 
     WHERE lawyer_id = ? AND status = '已生效'
     ORDER BY year DESC, quarter DESC
     LIMIT 8`,
    [lawyerId],
  );

  const [[yearlyRating]] = await pool.query(
    `SELECT * FROM yearly_ratings 
     WHERE lawyer_id = ? AND year = ? AND status = '已生效'
     LIMIT 1`,
    [lawyerId, currentYear - 1],
  );

  const [[lastYearRating]] = await pool.query(
    `SELECT subsidy_increase FROM yearly_ratings 
     WHERE lawyer_id = ? AND year = ? AND status = '已生效'
     LIMIT 1`,
    [lawyerId, currentYear - 1],
  );

  const subsidyIncreaseRate = 0.1;
  const hasSubsidyIncrease = lastYearRating?.subsidy_increase === 1;
  const currentSubsidy = lawyer.subsidy_base || 0;
  const effectiveSubsidy = hasSubsidyIncrease
    ? Math.round(currentSubsidy * (1 + subsidyIncreaseRate) * 100) / 100
    : currentSubsidy;

  const estimatedScores = {
    caseCountScore:
      Math.round(Math.min(100, (closedCount / quarterTarget) * 100) * 100) /
      100,
  };

  res.json({
    lawyer: {
      id: lawyer.id,
      name: lawyer.name,
      license_no: lawyer.license_no,
      firm: lawyer.firm,
      status: lawyer.status,
      subsidy_base: lawyer.subsidy_base,
    },
    currentQuarter: {
      year: currentYear,
      quarter: currentQuarter,
      closedCaseCount: closedCount,
      processingCaseCount: processingCount,
      processingCases,
      caseTarget: quarterTarget,
      caseProgress: Math.round(caseCountProgress * 100) / 100,
    },
    subsidy: {
      base: currentSubsidy,
      effective: effectiveSubsidy,
      hasIncrease: hasSubsidyIncrease,
      increaseRate: subsidyIncreaseRate,
    },
    estimatedScores,
    history: history.reverse(),
    yearlyRating: yearlyRating || null,
  });
});

router.get("/:id", async (req, res) => {
  const [[row]] = await pool.execute("SELECT * FROM lawyers WHERE id = ?", [
    req.params.id,
  ]);
  if (!row) return res.status(404).json({ error: "律师不存在" });
  res.json(row);
});

router.put("/:id/status", async (req, res) => {
  const { status } = req.body;
  if (!["可接案", "案件中", "休假"].includes(status)) {
    return res.status(400).json({ error: "无效状态" });
  }
  const [result] = await pool.execute(
    "UPDATE lawyers SET status = ? WHERE id = ?",
    [status, req.params.id],
  );
  if (result.affectedRows === 0)
    return res.status(404).json({ error: "律师不存在" });
  res.json({ message: "状态更新成功" });
});

module.exports = router;
