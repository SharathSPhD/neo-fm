export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.5" }
  public: {
    Tables: {
      jobs: {
        Row: {
          attempt_id: string | null
          attempts: number
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          last_attempt_at: string | null
          lease_renewed_at: string | null
          parent_job_id: string | null
          priority: number
          progress: number
          section_id: string | null
          song_document_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["job_status_enum"]
          trace_id: string | null
          user_id: string
        }
        Insert: {
          attempt_id?: string | null
          attempts?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          last_attempt_at?: string | null
          lease_renewed_at?: string | null
          parent_job_id?: string | null
          priority?: number
          progress?: number
          section_id?: string | null
          song_document_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status_enum"]
          trace_id?: string | null
          user_id: string
        }
        Update: {
          attempt_id?: string | null
          attempts?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          last_attempt_at?: string | null
          lease_renewed_at?: string | null
          parent_job_id?: string | null
          priority?: number
          progress?: number
          section_id?: string | null
          song_document_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status_enum"]
          trace_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      song_documents: {
        Row: {
          created_at: string
          document_json: Json
          id: string
          language: Database["public"]["Enums"]["language_enum"]
          style_family: Database["public"]["Enums"]["style_family_enum"]
          user_id: string
        }
        Insert: {
          created_at?: string
          document_json: Json
          id?: string
          language: Database["public"]["Enums"]["language_enum"]
          style_family: Database["public"]["Enums"]["style_family_enum"]
          user_id: string
        }
        Update: {
          created_at?: string
          document_json?: Json
          id?: string
          language?: Database["public"]["Enums"]["language_enum"]
          style_family?: Database["public"]["Enums"]["style_family_enum"]
          user_id?: string
        }
        Relationships: []
      }
      tracks: {
        Row: {
          attempt_id: string
          bytes: number | null
          created_at: string
          deleted_at: string | null
          duration_seconds: number | null
          expires_at: string | null
          format: Database["public"]["Enums"]["track_format_enum"]
          id: string
          job_id: string
          url: string
        }
        Insert: {
          attempt_id: string
          bytes?: number | null
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number | null
          expires_at?: string | null
          format?: Database["public"]["Enums"]["track_format_enum"]
          id?: string
          job_id: string
          url: string
        }
        Update: {
          attempt_id?: string
          bytes?: number | null
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number | null
          expires_at?: string | null
          format?: Database["public"]["Enums"]["track_format_enum"]
          id?: string
          job_id?: string
          url?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string
          email: string
          id: string
          locale: string | null
          name: string | null
          tier: Database["public"]["Enums"]["tier_enum"]
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          locale?: string | null
          name?: string | null
          tier?: Database["public"]["Enums"]["tier_enum"]
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          locale?: string | null
          name?: string | null
          tier?: Database["public"]["Enums"]["tier_enum"]
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at: string | null
          created_at: string
          id: string
          plan: Database["public"]["Enums"]["tier_enum"]
          renew_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          cancel_at?: string | null
          created_at?: string
          id?: string
          plan?: Database["public"]["Enums"]["tier_enum"]
          renew_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          cancel_at?: string | null
          created_at?: string
          id?: string
          plan?: Database["public"]["Enums"]["tier_enum"]
          renew_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {}
    Functions: {
      create_section_regen_job: {
        Args: {
          p_attempt_id?: string
          p_parent_job_id: string
          p_section_id: string
          p_trace_id?: string
        }
        Returns: {
          job_id: string
          parent_job_id: string
          section_id: string
          status: Database["public"]["Enums"]["job_status_enum"]
        }[]
      }
      create_song_job: {
        Args: {
          p_attempt_id?: string
          p_language: Database["public"]["Enums"]["language_enum"]
          p_priority?: number
          p_song_document: Json
          p_style_family: Database["public"]["Enums"]["style_family_enum"]
          p_target_duration_seconds: number
          p_trace_id?: string
        }
        Returns: {
          job_id: string
          song_id: string
          status: Database["public"]["Enums"]["job_status_enum"]
        }[]
      }
      enqueue_song_generation_job: { Args: { payload: Json }; Returns: number }
      user_jobs_count_month: { Args: { p_user_id: string }; Returns: number }
      user_jobs_count_today: { Args: { p_user_id: string }; Returns: number }
      user_storage_bytes: { Args: { p_user_id: string }; Returns: number }
      user_tier_quota: { Args: { p_user_id: string }; Returns: number }
      user_tier_storage_bytes_cap: { Args: { p_user_id: string }; Returns: number }
    }
    Enums: {
      job_status_enum: "queued" | "processing" | "completed" | "failed"
      language_enum: "en" | "hi" | "kn"
      style_family_enum: "western" | "carnatic" | "hindustani" | "kannada-folk"
      tier_enum: "free" | "creator" | "pro"
      track_format_enum: "wav" | "mp3" | "flac"
    }
    CompositeTypes: {}
  }
}
