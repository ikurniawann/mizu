"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { call, send } from "./api";
import type { Therapist } from "./types";

export type TrainingStatus = "enrolled" | "pending" | "passed" | "failed" | "cancelled";
export const trainingStatusLabel: Record<TrainingStatus, string> = {
  enrolled: "Terdaftar", pending: "Menunggu persetujuan", passed: "Lulus", failed: "Tidak lulus", cancelled: "Dibatalkan",
};
export interface Training {
  id: string; name: string; topic_code: string; period: string; training_date: string;
  trainer_name: string; notes: string; participant_count: number; passed_count: number;
}
export type TrainingInput = Omit<Training, "id" | "participant_count" | "passed_count">;
export interface TrainingParticipant {
  id: string; training_id: string; training_name: string; topic_code: string; period: string;
  training_date: string; trainer_name: string; therapist_id: string; therapist_name: string;
  employment_cycle: number; status: TrainingStatus; notes: string; reviewed_by: string | null; reviewed_at: string | null;
}
export interface TrainingCandidate {
  therapist_id: string; full_name: string; branch_id: string; branch_name: string; level: number;
  employment_status: string; is_active: boolean; status: TrainingStatus | ""; reviewed_at: string | null;
  similar_passes: { name: string; period: string }[]; missing_trainings: string[]; can_enroll: boolean; reason: string;
}
export interface LevelRequirements { level_1: string[]; level_2: string[] }
export interface MyTrainings {
  therapist: Therapist | null; participations: TrainingParticipant[];
  progress: { target_level: number; training_id: string; training_name: string; period: string; passed: boolean }[];
  history: { from_level: number; to_level: number; employment_cycle: number; reason: string; created_at: string }[];
}
const base = "/api/spa";
export const useTrainings = () => useQuery({ queryKey: ["spa", "trainings"], queryFn: () => call<Training[]>(`${base}/trainings`) });
export const useLevelRequirements = () => useQuery({ queryKey: ["spa", "level-requirements"], queryFn: () => call<LevelRequirements>(`${base}/level-requirements`) });
export const useTrainingParticipants = (id: string) => useQuery({ queryKey: ["spa", "training-participants", id], queryFn: () => call<TrainingParticipant[]>(`${base}/trainings/${id}/participants`) });
export const useTrainingCandidates = (id: string) => useQuery({ queryKey: ["spa", "training-candidates", id], queryFn: () => call<TrainingCandidate[]>(`${base}/trainings/${id}/candidates`) });
export const useMyTrainings = () => useQuery({ queryKey: ["spa", "my-trainings"], queryFn: () => call<MyTrainings>(`${base}/me/trainings`) });

function useTrainingMutation<T, R>(mutationFn: (input: T) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => client.invalidateQueries({ queryKey: ["spa"] }) });
}
export const useSaveTraining = () => useTrainingMutation(({ id, input }: { id?: string; input: TrainingInput }) => send<Training>(`${base}/trainings${id ? `/${id}` : ""}`, input, id ? "PUT" : "POST"));
export const useSaveLevelRequirements = () => useTrainingMutation((input: LevelRequirements) => send<LevelRequirements>(`${base}/level-requirements`, input, "PUT"));
export const useEnrollTraining = (id: string) => useTrainingMutation((ids: string[]) => send<TrainingParticipant[]>(`${base}/trainings/${id}/participants`, { therapist_ids: ids }));
export const useReviewTraining = () => useTrainingMutation(({ id, status, notes }: { id: string; status: Exclude<TrainingStatus, "enrolled">; notes: string }) => send<{ id: string }>(`${base}/training-participants/${id}/status`, { status, notes }));
