-- シーズン切り替えと選手選考のための設定（2026-11 幹事回答【5】〜【9】）
-- SQL Editor に貼り付けて1回実行する（何度実行しても問題ない）。
alter table public.settings add column if not exists season_start date;     -- 今シーズンの開始日（これより前の回は集計しない）
alter table public.settings add column if not exists selection_date date;   -- 選手選考の締め日（この日までのスコアで選考）
