import { ref } from "vue";

// status stream が接続済みで、接続直後の全量同期（fetchStatuses）まで終えているか。
// 切断中と再同期中はピルの値が一時的に欠けうるため、peek の変化検出が参照する。
export const statusStreamSettled = ref(false);
