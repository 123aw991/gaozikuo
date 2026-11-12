-- ============================================================
-- LLM 应用设计实验 · 数据库建表脚本（MySQL 8.0）
-- 字符集 utf8mb4，外键级联删除
-- ============================================================

CREATE DATABASE IF NOT EXISTS `llm_rag` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE `llm_rag`;

-- 会话表
DROP TABLE IF EXISTS `conversations`;
CREATE TABLE `conversations` (
  `id`         BIGINT AUTO_INCREMENT PRIMARY KEY,
  `title`      VARCHAR(120) NOT NULL DEFAULT '新会话',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_updated` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 消息表
DROP TABLE IF EXISTS `messages`;
CREATE TABLE `messages` (
  `id`               BIGINT AUTO_INCREMENT PRIMARY KEY,
  `conversation_id`  BIGINT NOT NULL,
  `role`             ENUM('system','user','assistant') NOT NULL,
  `content`          MEDIUMTEXT NOT NULL,
  `tokens`           INT DEFAULT 0,
  `created_at`       DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_conv` (`conversation_id`),
  CONSTRAINT `fk_msg_conv` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 知识库文档表
DROP TABLE IF EXISTS `kb_documents`;
CREATE TABLE `kb_documents` (
  `id`           BIGINT AUTO_INCREMENT PRIMARY KEY,
  `filename`     VARCHAR(255) NOT NULL,
  `ext`          VARCHAR(10) DEFAULT '',
  `size`         INT DEFAULT 0,
  `chars`        INT DEFAULT 0,
  `chunk_count`  INT DEFAULT 0,
  `status`       VARCHAR(20) DEFAULT 'ready',
  `created_at`   DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 知识库分块表
DROP TABLE IF EXISTS `kb_chunks`;
CREATE TABLE `kb_chunks` (
  `id`         BIGINT AUTO_INCREMENT PRIMARY KEY,
  `doc_id`     BIGINT NOT NULL,
  `seq`        INT NOT NULL,
  `content`    TEXT NOT NULL,
  `tokens`     INT DEFAULT 0,
  INDEX `idx_doc` (`doc_id`),
  CONSTRAINT `fk_chunk_doc` FOREIGN KEY (`doc_id`) REFERENCES `kb_documents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 提示词日志表（可选，用于实验记录）
DROP TABLE IF EXISTS `prompt_logs`;
CREATE TABLE `prompt_logs` (
  `id`         BIGINT AUTO_INCREMENT PRIMARY KEY,
  `scene`      VARCHAR(40) DEFAULT '',
  `model`      VARCHAR(80) DEFAULT '',
  `prompt`     MEDIUMTEXT,
  `tokens`     INT DEFAULT 0,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 测试数据（≥8 条）：2 个会话 + 消息 + 1 篇文档 + 分块 + 1 条提示词日志
-- ============================================================
INSERT INTO `conversations` (`id`, `title`) VALUES
  (1, '智能客服售后咨询'),
  (2, 'RAG 知识库问答测试');

INSERT INTO `messages` (`conversation_id`, `role`, `content`, `tokens`) VALUES
  (1, 'user',     '七天无理由退货有什么条件？', 12),
  (1, 'assistant', '根据《售后服务政策》：需商品完好、未激活、不影响二次销售，自签收次日起 7 日内可申请。[1]', 64),
  (1, 'user',     '退货后多久能收到退款？', 11),
  (1, 'assistant', '退款将在仓库签收并验收通过后 1-3 个工作日原路退回。[1]', 38),
  (2, 'user',     '你们系统支持上传哪些文件格式？', 13),
  (2, 'assistant', '支持 TXT / MD / PDF / DOC / DOCX / PPT / PPTX，文件均在本机解析。[1]', 51);

INSERT INTO `kb_documents` (`id`, `filename`, `ext`, `size`, `chars`, `chunk_count`, `status`) VALUES
  (1, '售后服务政策.md', 'md', 3343, 980, 2, 'ready');

INSERT INTO `kb_chunks` (`doc_id`, `seq`, `content`, `tokens`) VALUES
  (1, 0, '七天无理由退货：商品需保持完好、未使用、不影响二次销售，自签收次日起 7 日内可在订单页申请。', 48),
  (1, 1, '退款时效：仓库签收并验收通过后，款项将在 1-3 个工作日内原路退回至原支付账户。', 40);

INSERT INTO `prompt_logs` (`scene`, `model`, `prompt`, `tokens`) VALUES
  ('RAG 问答', 'qiniu/conatus-free', '你是企业知识库问答助手。请严格依据【参考资料】回答用户问题……', 36);
