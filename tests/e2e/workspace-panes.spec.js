/**
 * ワークスペース詳細ペイン（Files / Changes+Commit / History（Branches統合））と
 * ディープリンク（?ws=...&pane=...）の E2E スモーク。
 *
 * テスト用の git リポジトリを一時領域に作り、API（Bearer 認証）で
 * ワークスペース登録してから UI の各ペインを検証する。
 * 登録・作成したものはすべて afterAll で後始末する。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test, expect, BASE_URL, loadToken, login, bearerHeaders, deleteWorkspaceViaApi, openWorkspaces, listSessionIds, cleanupNewSessions } from "./helpers.js";

const COMMIT_MSG_INITIAL = "feat: e2e 初期コミット";
const COMMIT_MSG_UI = "test: e2e からのコミット";

/** テスト用リポジトリで git コマンドを実行する（識別情報はコマンド単位で指定） */
function git(dir, ...args) {
  execFileSync("git", ["-C", dir, "-c", "user.email=e2e@example.com", "-c", "user.name=e2e", ...args], {
    stdio: "pipe",
  });
}

test.describe.configure({ mode: "serial" });

test.describe("workspace detail panes", () => {
  let wsDir = "";
  let wsName = "";
  let branchName = "";

  test.beforeAll(async ({ request }) => {
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");

    wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "any-console-e2e-git-"));
    wsName = path.basename(wsDir);
    git(wsDir, "init");
    // サーバ経由の git commit / stash はグローバル設定の識別情報に依存するため、
    // CI ランナーのように未設定の環境でも動くようリポジトリローカルに設定しておく
    git(wsDir, "config", "user.email", "e2e@example.com");
    git(wsDir, "config", "user.name", "e2e");
    fs.writeFileSync(path.join(wsDir, "README.md"), "# e2e repo\n");
    fs.mkdirSync(path.join(wsDir, "src"));
    fs.writeFileSync(path.join(wsDir, "src", "app.js"), "console.log(\"e2e-app\");\n");
    git(wsDir, "add", ".");
    git(wsDir, "commit", "-m", COMMIT_MSG_INITIAL);
    branchName = execFileSync("git", ["-C", wsDir, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();

    const res = await request.post(`${BASE_URL}/workspaces`, {
      headers: bearerHeaders(token),
      data: { path: wsDir },
    });
    expect(res.ok()).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    // 削除を確認できないままディレクトリを消すと「消えたパスを指す登録」が
    // サーバに残るため、削除成功（または既に削除済み）を確認してから消す。
    const token = loadToken();
    if (token && wsName) {
      await deleteWorkspaceViaApi(request, token, wsName);
    }
    if (wsDir) fs.rmSync(wsDir, { recursive: true, force: true });
  });

  /** @type {string[] | null} テスト開始時点のセッション ID（ジョブ実行テストの後始末用。null = 未取得） */
  let sessionIdsBefore = null;

  test.beforeEach(async ({ page, context }) => {
    sessionIdsBefore = null;
    const token = loadToken();
    test.skip(!token, "ANY_CONSOLE_TOKEN または data/auth.json が必要");
    await login(page, context, token);
    sessionIdsBefore = await listSessionIds(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupNewSessions(page, sessionIdsBefore);
  });

  /** テスト用ワークスペースの詳細を開く。
   * ワークスペース一覧のワークスペース名クリックはJobsのインライン展開に
   * なり、詳細モーダルを開くUIボタンは無くなった（Job追加もツールバーの
   * Add jobへ移動）ため、ディープリンク（?ws=...&pane=...）経由で開く。 */
  async function openDetail(page, pane = "files") {
    await page.goto(`/?ws=${encodeURIComponent(wsName)}&pane=${pane}`);
    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.locator(".dialog-btn-ok").click();
    await expect(page.locator(".modal-title")).toContainText(wsName, { timeout: 10_000 });
  }

  test("git ワークスペースの詳細に各ペインのタブが表示される", async ({ page }) => {
    // Jobsはワークスペース一覧から開いた時の既定ペインとして残るが、
    // タブとしては表示しない（詳細内から戻れないようにする）。
    await openDetail(page);
    for (const label of ["Files", "History", "Changes", "Select & Copy"]) {
      await expect(page.locator(".workspace-tabs").getByRole("button", { name: label })).toBeVisible({ timeout: 10_000 });
    }
    await expect(page.locator(".workspace-tabs").getByRole("button", { name: "Jobs" })).not.toBeVisible();
  });

  test("Files ペインでディレクトリを辿ってファイル内容を表示できる", async ({ page }) => {
    await openDetail(page);
    await page.locator(".workspace-tabs").getByRole("button", { name: "Files" }).click();

    // ルート一覧: README.md と src/
    await expect(page.locator(".file-browser-item", { hasText: "README.md" })).toBeVisible({ timeout: 10_000 });
    await page.locator(".file-browser-item", { hasText: "src" }).click();
    await expect(page.locator(".file-browser-item", { hasText: "app.js" })).toBeVisible({ timeout: 10_000 });

    // ファイルを開くと内容が表示される
    await page.locator(".file-browser-item", { hasText: "app.js" }).click();
    await expect(page.locator(".file-content-viewer")).toContainText("e2e-app", { timeout: 10_000 });

    // パンくずのルートで一覧に戻れる
    await page.locator(".file-browser-crumb").first().click();
    await expect(page.locator(".file-browser-item", { hasText: "README.md" })).toBeVisible({ timeout: 10_000 });
  });

  test("Files ペインでファイルのリネームと削除ができる（各ダイアログあり）", async ({ page }) => {
    fs.writeFileSync(path.join(wsDir, "scratch.txt"), "temp\n");
    await openDetail(page);
    await page.locator(".workspace-tabs").getByRole("button", { name: "Files" }).click();

    // ファイルをクリックすると詳細画面に遷移し、ヘッダーに Move/Delete が並ぶ
    // （Rename/MoveはMoveへ統合済み。フルパスを編集することでリネームとして機能する）
    const row = page.locator(".file-browser-item", { hasText: "scratch.txt" });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();
    const headerActions = page.locator(".file-browser-header-actions");
    await expect(headerActions.getByRole("button", { name: "Rename or move" })).toBeVisible({ timeout: 5000 });
    await headerActions.getByRole("button", { name: "Rename or move" }).click();

    const promptDialog = page.locator(".prompt-dialog");
    await expect(promptDialog).toBeVisible({ timeout: 5000 });
    await expect(promptDialog).toContainText("Enter destination path.");
    await promptDialog.locator(".prompt-input").fill("scratch-renamed.txt");
    await promptDialog.locator(".dialog-btn-ok").click();

    // リネーム後は一覧（親ディレクトリ）に戻る
    const renamedRow = page.locator(".file-browser-item", { hasText: "scratch-renamed.txt" });
    await expect(renamedRow).toBeVisible({ timeout: 10_000 });

    // Delete → 確認ダイアログ（Confirm Rules）→ 一覧から消える
    await renamedRow.click();
    await expect(headerActions.getByRole("button", { name: "Delete" })).toBeVisible({ timeout: 5000 });
    await headerActions.getByRole("button", { name: "Delete" }).click();
    const confirmDialog = page.locator(".confirm-dialog");
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });
    await expect(confirmDialog).toContainText('Delete "scratch-renamed.txt"?');
    await confirmDialog.locator(".dialog-btn-ok").click();
    await expect(page.locator(".file-browser-item", { hasText: "scratch-renamed.txt" })).toHaveCount(0, { timeout: 10_000 });
  });

  test("History ペインにコミットが表示される", async ({ page }) => {
    await openDetail(page);
    await page.locator(".workspace-tabs").getByRole("button", { name: "History" }).click();
    await expect(page.locator(".git-log-entry-msg", { hasText: COMMIT_MSG_INITIAL })).toBeVisible({ timeout: 10_000 });
  });

  test("Changes ペインで変更ファイルが見えコミットできる（確認ダイアログあり）", async ({ page }) => {
    // 変更を作ってから Changes を開く
    fs.appendFileSync(path.join(wsDir, "README.md"), "\ne2e change\n");
    await openDetail(page);
    await page.locator(".workspace-tabs").getByRole("button", { name: "Changes" }).click();

    const row = page.locator(".diff-file-row", { hasText: "README.md" });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.locator(".diff-file-row-status")).toHaveText("M");

    // コミットメッセージを入れて Commit → 確認ダイアログ → OK
    await page.locator(".diff-commit-textarea").fill(COMMIT_MSG_UI);
    await page.locator(".diff-actions button", { hasText: "Commit" }).click();
    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText(COMMIT_MSG_UI);
    await dialog.locator(".dialog-btn-ok").click();
    await expect(page.locator(".toast", { hasText: "Committed" })).toBeVisible({ timeout: 10_000 });

    // History に反映されている
    await page.locator(".workspace-tabs").getByRole("button", { name: "History" }).click();
    await expect(page.locator(".git-log-entry-msg", { hasText: COMMIT_MSG_UI })).toBeVisible({ timeout: 10_000 });
  });

  test("Historyペイン内のBranchesに現在ブランチが表示され Add ダイアログを開閉できる", async ({ page }) => {
    await openDetail(page);
    await page.locator(".workspace-tabs").getByRole("button", { name: "History" }).click();
    // 現在ブランチの行（一覧の先頭項目 兼 開閉トグル）に現在ブランチ名が表示される
    const currentToggle = page.locator(".branch-item.current");
    await expect(currentToggle).toBeVisible({ timeout: 10_000 });
    await expect(currentToggle.locator(".branch-item-name")).toContainText(branchName);

    // Branch一覧は既定で畳まれているため、現在ブランチの行をクリックして開く
    await currentToggle.click();

    const current = page.locator(".branch-item.current");
    await expect(current).toBeVisible({ timeout: 10_000 });
    await expect(current.locator(".branch-item-name")).toContainText(branchName);

    // Add ダイアログ（Branch / Worktree 選択）を開いて Cancel で閉じる
    await page.locator('.branch-summary-add-btn').click();
    const addDialog = page.locator(".branch-add-dialog");
    await expect(addDialog).toBeVisible({ timeout: 5000 });
    await expect(addDialog).toContainText("Branch");
    await expect(addDialog).toContainText("Worktree");
    await addDialog.locator(".prompt-btn-cancel").click();
    await expect(addDialog).toBeHidden();
  });

  test("Historyペイン内のBranchesの Add ダイアログからブランチを作成できる", async ({ page }) => {
    const newBranch = "e2e/branch-test";
    await openDetail(page);
    await page.locator(".workspace-tabs").getByRole("button", { name: "History" }).click();
    await page.locator(".branch-item.current").click();

    await page.locator('.branch-summary-add-btn').click();
    const addDialog = page.locator(".branch-add-dialog");
    await expect(addDialog).toBeVisible({ timeout: 5000 });
    await addDialog.locator('input[type="radio"][value="branch"]').check();
    await addDialog.locator(".form-input").fill(newBranch);
    await addDialog.locator(".prompt-btn-ok").click();

    // 作成したブランチに切り替わった状態で一覧に現れる
    const current = page.locator(".branch-item.current");
    await expect(current).toBeVisible({ timeout: 10_000 });
    await expect(current.locator(".branch-item-name")).toContainText(newBranch);

    // 後続テストのために元のブランチへ戻しておく（テスト用リポジトリの後始末）
    git(wsDir, "checkout", branchName);
  });

  test("ワークスペース一覧のAdd jobでジョブを追加し、インライン展開したJobsから実行できる（確認ダイアログあり）", async ({ page }) => {
    const jobLabel = "E2E Job";
    const jobCommand = "echo job-e2e-$((40+2))";

    // ツールバーのAdd job（Editモード中のみ表示）からJobConfigを開き、
    // Scopeのプルダウンで対象ワークスペースを選ぶ（先頭はCommon job）
    await openWorkspaces(page);
    await page.locator('[aria-label="Edit workspaces"]').click();
    await page.locator('[aria-label="Add job"]').click();
    await expect(page.locator(".modal-title")).toHaveText("Add Job", { timeout: 5000 });
    await page.locator(".ws-settings-row", { hasText: "Scope" }).locator("select").selectOption(wsName);
    await page.locator('input[placeholder="Display name"]').fill(jobLabel);
    await page.locator(".job-command-input").fill(jobCommand);
    // 新規ジョブは確認なしが既定のため、確認ダイアログ経路を通すためにオンにする
    await page.locator(".form-check-label", { hasText: "Confirm dialog" }).locator("input").check();
    await page.locator("button.primary", { hasText: "Save" }).click();

    // 一覧へ戻り、ワークスペース名クリックでJobsをインライン展開して確認する
    await expect(page.locator(".modal-title")).toHaveText("Open Session", { timeout: 10_000 });
    const row = page.locator(".picker-ws-group", { has: page.locator(".picker-ws-header-label", { hasText: wsName }) });
    await row.locator(".picker-ws-header-label").click();
    const jobItem = row.locator(".job-item-row", { has: page.locator(".job-item-label", { hasText: jobLabel }) });
    await expect(jobItem).toBeVisible({ timeout: 10_000 });

    // 実行 → 確認ダイアログ（コマンドプレビュー付き）→ OK でターミナルが開き実行される
    const tabs = page.locator(".tab-btn");
    const tabCountBefore = await tabs.count();
    await jobItem.locator(".job-item").click();
    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText(jobLabel);
    await dialog.locator(".dialog-btn-ok").click();

    await expect(tabs).toHaveCount(tabCountBefore + 1, { timeout: 10_000 });
    const term = page.locator(".xterm >> visible=true").first();
    await expect(term).toBeVisible({ timeout: 10_000 });
    await expect(term).toContainText("job-e2e-42", { timeout: 15_000 });
  });

  test("Stash 保存と Drop ができる（不可逆操作の確認ダイアログあり）", async ({ page }) => {
    // 変更を作って Changes ペインから Stash する
    fs.appendFileSync(path.join(wsDir, "README.md"), "\nstash me\n");
    await openDetail(page);
    await page.locator(".workspace-tabs").getByRole("button", { name: "Changes" }).click();
    await expect(page.locator(".diff-file-row", { hasText: "README.md" })).toBeVisible({ timeout: 10_000 });
    await page.locator(".diff-actions button", { hasText: "Stash" }).click();
    await expect(page.locator(".toast", { hasText: "Saved" })).toBeVisible({ timeout: 10_000 });

    // カウント類を読み直すため詳細を開き直すと Stashes タブが現れる。
    // openDetail自体がpage.goto()でフルリロードするため、WorkspaceDetail
    // オーバーレイ（Settingsとは独立）を明示的に閉じる手順は不要。
    await openDetail(page);
    const stashTab = page.locator(".workspace-tabs").getByRole("button", { name: "Stashes" });
    await expect(stashTab).toBeVisible({ timeout: 10_000 });
    await stashTab.click();

    const entry = page.locator(".stash-entry").first();
    await expect(entry).toBeVisible({ timeout: 10_000 });

    // Drop は不可逆操作の確認文言つき
    await entry.locator(".commit-action-danger", { hasText: "Drop" }).click();
    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText("This cannot be undone.");
    await dialog.locator(".dialog-btn-ok").click();
    await expect(page.locator(".git-stash-pane-wrapper")).toContainText("No stash entries", { timeout: 10_000 });
  });

  test("ディープリンク（?ws=...&pane=files）で確認後に詳細が開く", async ({ page }) => {
    // login 済み cookie を使い、URL パラメータ付きで開き直す
    await page.goto(`/?ws=${encodeURIComponent(wsName)}&pane=files`);

    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toContainText("Open from URL?");
    await expect(dialog).toContainText(wsName);
    await dialog.locator(".dialog-btn-ok").click();

    // Files ペインが開き、リポジトリのファイルが見える
    await expect(page.locator(".modal-title")).toContainText(wsName, { timeout: 10_000 });
    await expect(page.locator(".file-browser-item", { hasText: "README.md" })).toBeVisible({ timeout: 10_000 });
  });
});
