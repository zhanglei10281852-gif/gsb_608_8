const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "3306"),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "legal123",
  database: process.env.DB_NAME || "legal_aid",
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: 10,
});

async function initDb() {
  const conn = await pool.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS applicants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        id_card VARCHAR(18) NOT NULL UNIQUE,
        gender ENUM('男','女') NOT NULL,
        phone VARCHAR(20),
        address VARCHAR(200),
        category ENUM('低保户','残疾人','老年人','未成年人','农民工','军人军属','其他') NOT NULL,
        income_level ENUM('无收入','低收入','一般'),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS lawyers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        license_no VARCHAR(30) NOT NULL UNIQUE,
        phone VARCHAR(20),
        firm VARCHAR(100) NOT NULL,
        speciality VARCHAR(50),
        status ENUM('可接案','案件中','休假') NOT NULL DEFAULT '可接案',
        case_count INT DEFAULT 0,
        subsidy_base DECIMAL(10,2) DEFAULT 0 COMMENT '补贴基数(元/月)',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS cases (
        id INT AUTO_INCREMENT PRIMARY KEY,
        case_no VARCHAR(20) NOT NULL UNIQUE,
        applicant_id INT NOT NULL,
        lawyer_id INT,
        case_type ENUM('民事','刑事','行政','劳动争议','婚姻家庭','其他') NOT NULL,
        description TEXT,
        status ENUM('待审批','已批准','已指派','办理中','已结案','已驳回') NOT NULL DEFAULT '待审批',
        approve_reason VARCHAR(500),
        reject_reason VARCHAR(500),
        result TEXT,
        satisfaction_score TINYINT DEFAULT NULL COMMENT '满意度评分1-5，T45回访数据，默认NULL表示未回访',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        closed_at DATETIME DEFAULT NULL COMMENT '结案时间',
        FOREIGN KEY (applicant_id) REFERENCES applicants(id),
        FOREIGN KEY (lawyer_id) REFERENCES lawyers(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS assessment_config (
        id INT AUTO_INCREMENT PRIMARY KEY,
        config_key VARCHAR(50) NOT NULL UNIQUE,
        config_value VARCHAR(200) NOT NULL,
        description VARCHAR(200),
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS complaints (
        id INT AUTO_INCREMENT PRIMARY KEY,
        case_id INT NOT NULL,
        lawyer_id INT NOT NULL,
        applicant_id INT NOT NULL,
        content TEXT NOT NULL,
        status ENUM('待处理','已处理','已撤销') NOT NULL DEFAULT '待处理',
        result VARCHAR(500),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (case_id) REFERENCES cases(id),
        FOREIGN KEY (lawyer_id) REFERENCES lawyers(id),
        FOREIGN KEY (applicant_id) REFERENCES applicants(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS consultations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        lawyer_id INT NOT NULL,
        applicant_id INT DEFAULT NULL,
        consult_type ENUM('电话咨询','现场咨询','线上咨询') NOT NULL DEFAULT '现场咨询',
        content TEXT,
        rating TINYINT DEFAULT NULL COMMENT '群众评价1-5分',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (lawyer_id) REFERENCES lawyers(id),
        FOREIGN KEY (applicant_id) REFERENCES applicants(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS quarterly_assessments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        lawyer_id INT NOT NULL,
        year INT NOT NULL,
        quarter TINYINT NOT NULL COMMENT '季度1-4',
        case_count INT DEFAULT 0 COMMENT '办结案件数',
        case_count_score DECIMAL(5,2) DEFAULT 0 COMMENT '办案数量得分',
        quality_score DECIMAL(5,2) DEFAULT 0 COMMENT '办案质量得分',
        avg_cycle_days DECIMAL(8,2) DEFAULT 0 COMMENT '平均办案周期(天)',
        efficiency_score DECIMAL(5,2) DEFAULT 0 COMMENT '办案时效得分',
        consultation_count INT DEFAULT 0 COMMENT '咨询接待量',
        attitude_score DECIMAL(5,2) DEFAULT 0 COMMENT '服务态度得分',
        total_score DECIMAL(5,2) DEFAULT 0 COMMENT '综合分',
        grade ENUM('优秀','良好','合格','待改进') DEFAULT '合格' COMMENT '季度评级',
        status ENUM('待确认','已确认','已生效') NOT NULL DEFAULT '待确认' COMMENT '考核状态',
        confirmed_by VARCHAR(50) DEFAULT NULL COMMENT '确认人',
        confirmed_at DATETIME DEFAULT NULL COMMENT '确认时间',
        remark VARCHAR(500) DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_lawyer_quarter (lawyer_id, year, quarter),
        FOREIGN KEY (lawyer_id) REFERENCES lawyers(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS yearly_ratings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        lawyer_id INT NOT NULL,
        year INT NOT NULL,
        q1_score DECIMAL(5,2) DEFAULT NULL,
        q2_score DECIMAL(5,2) DEFAULT NULL,
        q3_score DECIMAL(5,2) DEFAULT NULL,
        q4_score DECIMAL(5,2) DEFAULT NULL,
        avg_score DECIMAL(5,2) DEFAULT 0 COMMENT '年度综合分',
        grade ENUM('A','B','C','D') DEFAULT 'C' COMMENT '年度评级',
        consecutive_d_years INT DEFAULT 0 COMMENT '连续D级年数',
        suggest_terminate TINYINT DEFAULT 0 COMMENT '建议解除合作 0否1是',
        subsidy_increase TINYINT DEFAULT 0 COMMENT '下一年度补贴是否上浮 0否1是',
        status ENUM('待确认','已生效') NOT NULL DEFAULT '待确认',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_lawyer_year (lawyer_id, year),
        FOREIGN KEY (lawyer_id) REFERENCES lawyers(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [configCount] = await conn.execute(
      "SELECT COUNT(*) as cnt FROM assessment_config",
    );
    if (configCount[0].cnt === 0) {
      await conn.execute(`
        INSERT INTO assessment_config (config_key, config_value, description) VALUES
        ('quarterly_case_target', '8', '季度办案目标数量(件)'),
        ('standard_cycle_days', '60', '标准办案周期(天)'),
        ('weight_case_count', '0.3', '办案数量权重'),
        ('weight_quality', '0.3', '办案质量权重'),
        ('weight_efficiency', '0.2', '办案时效权重'),
        ('weight_attitude', '0.2', '服务态度权重'),
        ('excellent_threshold', '85', '优秀/合格线'),
        ('good_threshold', '70', '良好分数线'),
        ('pass_threshold', '60', '合格分数线'),
        ('default_satisfaction', '3', '默认满意度评分(满分5分)'),
        ('subsidy_increase_rate', '0.1', 'A级律师补贴上浮比例')
      `);
    }

    console.log("数据库表初始化完成");
  } finally {
    conn.release();
  }
}

module.exports = { pool, initDb };
