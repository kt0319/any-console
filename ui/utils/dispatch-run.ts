export type DispatchRunForm = {
  workspace: string,
  branch: string,
  baseBranch: string,
  text: string,
  job: string,
  isNewSession: boolean,
  sessionId: string,
  createBranch: boolean,
  imagePaths: string[],
};

/**
 * Dispatch 実行画面の入力値のうち、元のリクエストから変わったものだけを送る override にする
 * （変わっていない項目は null）。
 */
export function buildDispatchOverrides(orig: Record<string, any>, form: DispatchRunForm) {
  // 元リクエストの新規セッション判定は existing_session_id の有無ではなく match
  // （サーバー既定"any"）で見る。existing_session_idが無いことは「新規確定」を意味しない
  // （match:"any"で既存セッションに解決された場合も記録されない）ため、existing_session_id
  // 基準にすると「+ New session」を選んでも変化なしと誤判定されoverrideが送られない。
  const origIsNew = (orig.match || "any") === "none";
  const origImagePaths = Array.isArray(orig.image_paths) ? orig.image_paths : [];
  const imagePathsChanged = JSON.stringify(form.imagePaths) !== JSON.stringify(origImagePaths);
  return {
    workspace: form.workspace !== (orig.workspace || "") ? form.workspace : null,
    branch: form.branch !== (orig.branch || "") ? form.branch : null,
    base_branch: form.baseBranch !== (orig.base_branch || "") ? form.baseBranch : null,
    text: form.text !== (orig.text || "") ? form.text : null,
    job: form.job !== (orig.job || "terminal") ? form.job : null,
    match: form.isNewSession !== origIsNew ? (form.isNewSession ? "none" : "any") : null,
    session_id: !form.isNewSession && form.sessionId !== (orig.existing_session_id || null) ? form.sessionId : null,
    create_branch: form.createBranch !== !!orig.create_branch ? form.createBranch : null,
    image_paths: imagePathsChanged ? form.imagePaths : null,
  };
}
