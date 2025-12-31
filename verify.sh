#!/bin/bash
# AIDOS 統合検証コマンド
# TypeScriptコンパイル、テスト、セキュリティスキャン、ビルドを一括実行
# 終了コード: 0=成功, 1=失敗

set -e

# 色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# プロジェクトルートディレクトリ
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 結果保存ディレクトリ
RESULTS_DIR="$SCRIPT_DIR/.verify-results"
mkdir -p "$RESULTS_DIR"

# タイムスタンプ
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
RESULT_FILE="$RESULTS_DIR/result_$TIMESTAMP.json"

# 結果変数
COMPILE_RESULT="pending"
COMPILE_ERRORS=""
TEST_RESULT="pending"
TEST_SUMMARY=""
SECURITY_RESULT="pending"
SECURITY_ISSUES=""
BUILD_RESULT="pending"
BUILD_ERRORS=""
OVERALL_RESULT="pending"

# ========================================
# ユーティリティ関数
# ========================================

print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE} $1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[FAILED]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# ========================================
# 1. TypeScriptコンパイルチェック
# ========================================

check_typescript() {
    print_header "TypeScript Compile Check"

    if ! command -v npx &> /dev/null; then
        print_error "npx not found"
        COMPILE_RESULT="error"
        COMPILE_ERRORS="npx command not found"
        return 1
    fi

    print_info "Running tsc --noEmit..."

    local output
    if output=$(npx tsc --noEmit 2>&1); then
        print_success "TypeScript compilation check passed"
        COMPILE_RESULT="success"
        COMPILE_ERRORS=""
        return 0
    else
        print_error "TypeScript compilation failed"
        COMPILE_RESULT="failed"
        COMPILE_ERRORS=$(echo "$output" | head -50)
        echo "$output"
        return 1
    fi
}

# ========================================
# 2. テスト実行
# ========================================

run_tests() {
    print_header "Test Execution"

    local test_output_file="$RESULTS_DIR/test_output_$TIMESTAMP.json"

    print_info "Running vitest..."

    local output
    if output=$(npx vitest run --reporter=json --outputFile="$test_output_file" 2>&1); then
        print_success "All tests passed"
        TEST_RESULT="success"

        # テスト結果サマリーを取得
        if [ -f "$test_output_file" ]; then
            TEST_SUMMARY=$(cat "$test_output_file")
        fi
        return 0
    else
        # テストが失敗した場合もJSON結果を読み取る
        if [ -f "$test_output_file" ]; then
            TEST_SUMMARY=$(cat "$test_output_file")
            local failed_count=$(echo "$TEST_SUMMARY" | grep -o '"failed":[0-9]*' | cut -d':' -f2 | head -1)
            print_error "Tests failed: $failed_count test(s)"
        else
            print_error "Tests failed"
            TEST_SUMMARY='{"error": "Test execution failed"}'
        fi
        TEST_RESULT="failed"
        echo "$output"
        return 1
    fi
}

# ========================================
# 3. セキュリティスキャン
# ========================================

run_security_scan() {
    print_header "Security Scan"

    local security_output_file="$RESULTS_DIR/security_$TIMESTAMP.json"
    local issues_found=0
    local secrets_found=()
    local dangerous_patterns=()
    local blocked_files=()

    print_info "Scanning for secrets and dangerous patterns..."

    # シークレットパターンのスキャン
    local secret_patterns=(
        'sk-[a-zA-Z0-9]{48,}'           # OpenAI API Key
        'sk-ant-[a-zA-Z0-9-]{32,}'      # Anthropic API Key
        'ghp_[a-zA-Z0-9]{36,}'          # GitHub Personal Access Token
        'AKIA[0-9A-Z]{16}'              # AWS Access Key ID
        'password["\x27]?\s*[:=]\s*["\x27][^"\x27]{8,}["\x27]'  # Hardcoded password
    )

    # ブロック対象ファイルパターン
    local blocked_patterns=(
        '\.env$'
        '\.env\.'
        'secrets\.json'
        'credentials\.json'
        '\.pem$'
        '\.key$'
        'id_rsa'
    )

    # srcディレクトリ内のファイルをスキャン
    while IFS= read -r -d '' file; do
        local filename=$(basename "$file")

        # ブロック対象ファイルチェック
        for pattern in "${blocked_patterns[@]}"; do
            if echo "$filename" | grep -qE "$pattern"; then
                blocked_files+=("$file")
                ((issues_found++))
            fi
        done

        # ファイル内容のシークレットスキャン
        if [ -f "$file" ] && [ -r "$file" ]; then
            for pattern in "${secret_patterns[@]}"; do
                if grep -qE "$pattern" "$file" 2>/dev/null; then
                    secrets_found+=("$file: matches pattern $pattern")
                    ((issues_found++))
                fi
            done

            # 危険なパターンのチェック
            if grep -qE '\beval\s*\(' "$file" 2>/dev/null; then
                dangerous_patterns+=("$file: eval() usage detected")
                ((issues_found++))
            fi

            if grep -qE 'child_process.*exec.*\+' "$file" 2>/dev/null; then
                dangerous_patterns+=("$file: potential command injection")
                ((issues_found++))
            fi
        fi
    done < <(find src -type f \( -name "*.ts" -o -name "*.js" -o -name "*.json" \) -print0 2>/dev/null)

    # 結果をJSONに保存
    {
        echo "{"
        echo '  "timestamp": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'",'
        echo '  "issuesFound": '"$issues_found"','
        echo '  "blockedFiles": ['
        local first=true
        for bf in "${blocked_files[@]}"; do
            if [ "$first" = true ]; then
                first=false
            else
                echo ","
            fi
            echo -n '    "'"$bf"'"'
        done
        echo ""
        echo '  ],'
        echo '  "secrets": ['
        first=true
        for sf in "${secrets_found[@]}"; do
            if [ "$first" = true ]; then
                first=false
            else
                echo ","
            fi
            echo -n '    "'"$sf"'"'
        done
        echo ""
        echo '  ],'
        echo '  "dangerousPatterns": ['
        first=true
        for dp in "${dangerous_patterns[@]}"; do
            if [ "$first" = true ]; then
                first=false
            else
                echo ","
            fi
            echo -n '    "'"$dp"'"'
        done
        echo ""
        echo '  ]'
        echo "}"
    } > "$security_output_file"

    SECURITY_ISSUES=$(cat "$security_output_file")

    if [ $issues_found -eq 0 ]; then
        print_success "No security issues found"
        SECURITY_RESULT="success"
        return 0
    else
        print_warning "Found $issues_found security issue(s)"

        if [ ${#blocked_files[@]} -gt 0 ]; then
            print_error "Blocked files detected:"
            for bf in "${blocked_files[@]}"; do
                echo "  - $bf"
            done
        fi

        if [ ${#secrets_found[@]} -gt 0 ]; then
            print_error "Potential secrets detected:"
            for sf in "${secrets_found[@]}"; do
                echo "  - $sf"
            done
        fi

        if [ ${#dangerous_patterns[@]} -gt 0 ]; then
            print_warning "Dangerous patterns detected:"
            for dp in "${dangerous_patterns[@]}"; do
                echo "  - $dp"
            done
        fi

        # secretsやblocked filesがある場合は失敗
        if [ ${#secrets_found[@]} -gt 0 ] || [ ${#blocked_files[@]} -gt 0 ]; then
            SECURITY_RESULT="failed"
            return 1
        else
            SECURITY_RESULT="warning"
            return 0
        fi
    fi
}

# ========================================
# 4. ビルド確認
# ========================================

check_build() {
    print_header "Build Check"

    print_info "Running npm run build..."

    local output
    if output=$(npm run build 2>&1); then
        print_success "Build completed successfully"
        BUILD_RESULT="success"
        BUILD_ERRORS=""

        # ビルド成果物の確認
        if [ -d "dist" ]; then
            local file_count=$(find dist -name "*.js" | wc -l | tr -d ' ')
            print_info "Generated $file_count JavaScript file(s)"
        fi
        return 0
    else
        print_error "Build failed"
        BUILD_RESULT="failed"
        BUILD_ERRORS=$(echo "$output" | tail -50)
        echo "$output"
        return 1
    fi
}

# ========================================
# 5. 結果サマリー出力
# ========================================

output_summary() {
    print_header "Verification Summary"

    local exit_code=0

    # 各チェックの結果表示
    echo ""
    echo "Results:"
    echo "--------"

    if [ "$COMPILE_RESULT" = "success" ]; then
        echo -e "  TypeScript Compile: ${GREEN}PASSED${NC}"
    else
        echo -e "  TypeScript Compile: ${RED}FAILED${NC}"
        exit_code=1
    fi

    if [ "$TEST_RESULT" = "success" ]; then
        echo -e "  Test Execution:     ${GREEN}PASSED${NC}"
    elif [ "$TEST_RESULT" = "pending" ]; then
        echo -e "  Test Execution:     ${YELLOW}SKIPPED${NC}"
    else
        echo -e "  Test Execution:     ${RED}FAILED${NC}"
        exit_code=1
    fi

    if [ "$SECURITY_RESULT" = "success" ]; then
        echo -e "  Security Scan:      ${GREEN}PASSED${NC}"
    elif [ "$SECURITY_RESULT" = "warning" ]; then
        echo -e "  Security Scan:      ${YELLOW}WARNING${NC}"
    else
        echo -e "  Security Scan:      ${RED}FAILED${NC}"
        exit_code=1
    fi

    if [ "$BUILD_RESULT" = "success" ]; then
        echo -e "  Build:              ${GREEN}PASSED${NC}"
    else
        echo -e "  Build:              ${RED}FAILED${NC}"
        exit_code=1
    fi

    echo ""

    # 全体結果
    if [ $exit_code -eq 0 ]; then
        OVERALL_RESULT="success"
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN} ALL CHECKS PASSED${NC}"
        echo -e "${GREEN}========================================${NC}"
    else
        OVERALL_RESULT="failed"
        echo -e "${RED}========================================${NC}"
        echo -e "${RED} VERIFICATION FAILED${NC}"
        echo -e "${RED}========================================${NC}"
    fi

    # JSON結果ファイルに保存
    {
        echo "{"
        echo '  "timestamp": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'",'
        echo '  "overall": "'"$OVERALL_RESULT"'",'
        echo '  "checks": {'
        echo '    "compile": {'
        echo '      "result": "'"$COMPILE_RESULT"'",'
        echo '      "errors": "'"$(echo "$COMPILE_ERRORS" | tr '\n' ' ' | sed 's/"/\\"/g')"'"'
        echo '    },'
        echo '    "test": {'
        echo '      "result": "'"$TEST_RESULT"'"'
        echo '    },'
        echo '    "security": {'
        echo '      "result": "'"$SECURITY_RESULT"'"'
        echo '    },'
        echo '    "build": {'
        echo '      "result": "'"$BUILD_RESULT"'",'
        echo '      "errors": "'"$(echo "$BUILD_ERRORS" | tr '\n' ' ' | sed 's/"/\\"/g')"'"'
        echo '    }'
        echo '  }'
        echo "}"
    } > "$RESULT_FILE"

    echo ""
    print_info "Result saved to: $RESULT_FILE"

    return $exit_code
}

# ========================================
# メイン処理
# ========================================

main() {
    local skip_tests=false
    local only_check=""

    # 引数パース
    while [[ $# -gt 0 ]]; do
        case $1 in
            --skip-tests)
                skip_tests=true
                shift
                ;;
            --only)
                only_check="$2"
                shift 2
                ;;
            -h|--help)
                echo "Usage: verify.sh [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --skip-tests    Skip test execution"
                echo "  --only TYPE     Run only specific check (compile|test|security|build)"
                echo "  -h, --help      Show this help message"
                exit 0
                ;;
            *)
                echo "Unknown option: $1"
                exit 1
                ;;
        esac
    done

    echo ""
    echo -e "${BLUE}AIDOS Verification Script${NC}"
    echo -e "${BLUE}=========================${NC}"
    echo ""
    print_info "Started at: $(date)"
    print_info "Project: $SCRIPT_DIR"

    local all_passed=true

    # 特定のチェックのみ実行
    if [ -n "$only_check" ]; then
        case $only_check in
            compile)
                check_typescript || all_passed=false
                ;;
            test)
                run_tests || all_passed=false
                ;;
            security)
                run_security_scan || all_passed=false
                ;;
            build)
                check_build || all_passed=false
                ;;
            *)
                echo "Unknown check type: $only_check"
                exit 1
                ;;
        esac
    else
        # 全チェック実行
        check_typescript || all_passed=false

        if [ "$skip_tests" = false ]; then
            run_tests || all_passed=false
        else
            print_info "Skipping tests (--skip-tests)"
            TEST_RESULT="skipped"
        fi

        run_security_scan || all_passed=false

        check_build || all_passed=false
    fi

    # サマリー出力
    output_summary

    exit $?
}

main "$@"
