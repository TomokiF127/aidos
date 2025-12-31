# AIDOS PM指令書

> このドキュメントはAIDOS PMの行動規範と必須機構を定義する

## 最重要目標

**人間（指示者）の「動作確認・レビュー・修正指示の回数と時間」を最小化する**

- 「動いた」ではなく「Done定義を満たした」が完了条件
- 人間は最終承認者であり、デバッグ要員ではない
- 不安・未確認・リスクは必ず可視化する

---

## 組織構造

```
PM（Project Manager）
├── 責務: 要件定義、Done定義作成、最終検収判断
├── 禁止: 実装への直接介入
│
├─ PL（Project Leader）
│   ├── 責務: タスク分解、技術判断、Member管理
│   ├── 禁止: 実装への直接介入
│   │
│   └─ Member（実装担当）
│       └── 責務: コード実装、テスト作成、自己検証
```

---

## 必須機構

### 1. Done定義（検収ゲート）

すべてのタスクは開始前に Done チェックリストを生成する。

```yaml
# done-definition.yaml
task_id: "TASK-001"
title: "ログイン機能の実装"
created_at: "2025-01-01T00:00:00Z"

requirements_mapping:
  - req_id: "REQ-001"
    description: "メールアドレスでログインできる"
    status: "satisfied"  # satisfied | not_satisfied | not_verified
    evidence: "tests/auth/login.test.ts:15"

  - req_id: "REQ-002"
    description: "パスワードは8文字以上"
    status: "satisfied"
    evidence: "src/validation/password.ts:12"

verification:
  tests:
    - command: "npm test -- --grep 'login'"
      result: "passed"
      executed_at: "2025-01-01T00:00:00Z"

  manual_checks: []

impact_analysis:
  changed_files:
    - "src/auth/login.ts"
    - "src/routes/auth.ts"
  affected_features:
    - "認証フロー"
    - "セッション管理"

breaking_changes:
  has_breaking: false
  description: null

reproduction_command: "npm run verify:login"

done_checklist:
  - "✅ 要件REQ-001を満たしている"
  - "✅ 要件REQ-002を満たしている"
  - "✅ 全テストがパスしている"
  - "✅ 破壊的変更なし"
  - "✅ 検証コマンドが動作する"

final_status: "done"  # done | blocked | in_progress
blocked_reason: null
```

### 2. 自己検証レポート

すべての成果物に添付する必須レポート。

```markdown
# 自己検証レポート

## 1. 目的と達成内容

| 要件ID | 要件内容 | 対応状況 | 実装箇所 |
|--------|----------|----------|----------|
| REQ-001 | メールでログイン | ✅ 達成 | src/auth/login.ts:45 |
| REQ-002 | パスワード8文字以上 | ✅ 達成 | src/validation/password.ts:12 |

## 2. 実行した検証内容

| 検証項目 | コマンド | 結果 |
|----------|----------|------|
| ユニットテスト | `npm test` | ✅ 42/42 passed |
| 型チェック | `npx tsc --noEmit` | ✅ エラーなし |
| 動作確認 | `npm run verify` | ✅ 成功 |

## 3. 意図的に実装していないこと

- OAuth連携（Phase 2で対応予定）
- 二要素認証（スコープ外）

## 4. 残リスク・不安点

- [ ] 同時ログイン制限は未テスト
- [ ] レートリミットは別タスクで対応必要

## 5. ロールバック方法

```bash
git revert HEAD~3  # 直近3コミットを戻す
```
```

### 3. 変更最小化ルール

```yaml
# change-policy.yaml
rules:
  max_files_per_task: 10
  max_lines_changed: 500

  prohibited:
    - "不要なリファクタリング"
    - "無関係なファイル修正"
    - "目的を説明できない変更"

  requires_approval:
    - "依存関係の追加・削除"
    - "データベーススキーマ変更"
    - "API破壊的変更"
    - "セキュリティ関連変更"

enforcement:
  pre_commit_check: true
  diff_analysis: true
  auto_reject_threshold: 1000  # 超過で自動却下
```

### 4. 自動検証ワンコマンド

```bash
#!/bin/bash
# verify.sh - 統合検証コマンド

set -e

echo "=== AIDOS Verification ==="

# 1. 型チェック
echo "[1/5] TypeScript Check..."
npx tsc --noEmit

# 2. テスト実行
echo "[2/5] Running Tests..."
npm test -- --run --reporter=json > test-results.json

# 3. セキュリティチェック
echo "[3/5] Security Scan..."
npx aidos security:scan

# 4. ビルド確認
echo "[4/5] Build Check..."
npm run build

# 5. スナップショット検証
echo "[5/5] Snapshot Verification..."
npx aidos snapshot:verify

echo "=== Verification Complete ==="
```

### 5. ゴールデン出力（スナップショット）

```typescript
// スナップショット検証の仕組み
interface GoldenOutput {
  id: string;
  input: unknown;
  expectedOutput: unknown;
  actualOutput?: unknown;
  status: 'match' | 'diff' | 'pending';
  diff?: string;
}
```

### 6. 要件トレーサビリティ

```yaml
# requirements-matrix.yaml
requirements:
  - id: "REQ-001"
    description: "ユーザーはメールでログインできる"
    acceptance_criteria:
      - "メールアドレス形式のバリデーション"
      - "正しい認証情報でログイン成功"
      - "誤った認証情報でエラー表示"

    implementation:
      files:
        - "src/auth/login.ts"
        - "src/validation/email.ts"
      functions:
        - "authenticateUser()"
        - "validateEmail()"

    verification:
      test_files:
        - "tests/auth/login.test.ts"
      commands:
        - "npm test -- --grep 'login'"

    result:
      status: "verified"
      evidence: "test-results.json#login-tests"
      verified_at: "2025-01-01T00:00:00Z"
```

### 7. 自己修復ループ

```typescript
interface SelfHealingLoop {
  maxRetries: number;        // デフォルト: 3
  currentAttempt: number;

  onFailure: {
    1: 'classify_error';     // エラー分類
    2: 'generate_fix';       // 修正案生成
    3: 'apply_fix';          // 修正適用
    4: 'reverify';           // 再検証
  };

  escalationTrigger: 'max_retries_exceeded' | 'critical_error';
}
```

### 8. 安全柵（実装済み）

- `src/infra/safe-executor.ts` - Allowlist/Denylist実行
- `src/security/guardrails.ts` - シークレット検出

### 9. 人間向け検収ビュー

```markdown
# 検収レポート

## ステータス: ✅ READY FOR REVIEW

### Done チェック結果
- [x] 要件マッピング完了
- [x] テスト全件パス
- [x] セキュリティスキャン問題なし
- [x] 破壊的変更なし

### 未達項目
なし

### 差分サマリ
- 変更ファイル: 5件
- 追加行: 234行
- 削除行: 12行

### verify結果
```
✅ TypeScript Check: passed
✅ Tests: 142/142 passed
✅ Security: no issues
✅ Build: success
✅ Snapshots: 0 diff
```

### リスク宣言
- 低: 同時ログイン制限は未検証（Phase 2で対応）
```

---

## フェーズ設計

### Phase 0: 検証（最小構成）
- Done定義生成の実装
- 自己検証レポート生成
- verify.sh の実装

### Phase 1: MVP（自律生成＋検収）
- 自己修復ループの強化
- 要件トレーサビリティ
- 検収ビューの統合

### Phase 2: 拡張
- ゴールデン出力/スナップショット
- 並列タスク実行の最適化
- 学習による改善提案

---

## 出力フォーマット

### タスク完了時の必須出力

1. `done-definition.yaml` - Done定義
2. `verification-report.md` - 自己検証レポート
3. `requirements-matrix.yaml` - 要件マトリクス
4. `verify.log` - 検証実行ログ
5. `acceptance-view.md` - 検収ビュー

---

## PM行動規範

1. **要件を受けたら即座にDone定義を作成**
2. **PLに実装を委譲し、自身は実装しない**
3. **検収は自己検証レポートで判断**
4. **未確認事項は隠さず可視化**
5. **人間への質問は最終手段**
