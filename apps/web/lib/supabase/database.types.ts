export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      cover_art: {
        Row: {
          created_at: string
          id: string
          is_current: boolean
          job_id: string
          model_version: string | null
          prompt: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_current?: boolean
          job_id: string
          model_version?: string | null
          prompt: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          is_current?: boolean
          job_id?: string
          model_version?: string | null
          prompt?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "cover_art_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cover_art_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "orphan_jobs"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "cover_art_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "recent_vocal_quality"
            referencedColumns: ["job_id"]
          },
        ]
      }
      cover_art_attempts: {
        Row: {
          attempt_id: string
          created_at: string
          error: string | null
          id: string
          job_id: string
          model_version: string | null
          prompt: string
          status: string
          storage_path: string | null
          trace_id: string | null
          updated_at: string
        }
        Insert: {
          attempt_id: string
          created_at?: string
          error?: string | null
          id?: string
          job_id: string
          model_version?: string | null
          prompt: string
          status: string
          storage_path?: string | null
          trace_id?: string | null
          updated_at?: string
        }
        Update: {
          attempt_id?: string
          created_at?: string
          error?: string | null
          id?: string
          job_id?: string
          model_version?: string | null
          prompt?: string
          status?: string
          storage_path?: string | null
          trace_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cover_art_attempts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cover_art_attempts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "orphan_jobs"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "cover_art_attempts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "recent_vocal_quality"
            referencedColumns: ["job_id"]
          },
        ]
      }
      feedback: {
        Row: {
          body: string
          created_at: string
          id: string
          referrer: string | null
          status: string
          subject: string
          user_id: string | null
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          referrer?: string | null
          status?: string
          subject: string
          user_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          referrer?: string | null
          status?: string
          subject?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      follows: {
        Row: {
          created_at: string
          followee_id: string
          follower_id: string
        }
        Insert: {
          created_at?: string
          followee_id: string
          follower_id: string
        }
        Update: {
          created_at?: string
          followee_id?: string
          follower_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follows_followee_id_fkey"
            columns: ["followee_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_followee_id_fkey"
            columns: ["followee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempt_id: string | null
          attempts: number
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          is_favorite: boolean
          last_attempt_at: string | null
          lease_renewed_at: string | null
          parent_job_id: string | null
          priority: number
          progress: number
          public_id: string | null
          published_at: string | null
          published_visibility: Database["public"]["Enums"]["song_visibility_enum"]
          recovered_at: string | null
          remixed_from: string | null
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
          is_favorite?: boolean
          last_attempt_at?: string | null
          lease_renewed_at?: string | null
          parent_job_id?: string | null
          priority?: number
          progress?: number
          public_id?: string | null
          published_at?: string | null
          published_visibility?: Database["public"]["Enums"]["song_visibility_enum"]
          recovered_at?: string | null
          remixed_from?: string | null
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
          is_favorite?: boolean
          last_attempt_at?: string | null
          lease_renewed_at?: string | null
          parent_job_id?: string | null
          priority?: number
          progress?: number
          public_id?: string | null
          published_at?: string | null
          published_visibility?: Database["public"]["Enums"]["song_visibility_enum"]
          recovered_at?: string | null
          remixed_from?: string | null
          section_id?: string | null
          song_document_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status_enum"]
          trace_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "orphan_jobs"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "recent_vocal_quality"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "jobs_remixed_from_fkey"
            columns: ["remixed_from"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_remixed_from_fkey"
            columns: ["remixed_from"]
            isOneToOne: false
            referencedRelation: "orphan_jobs"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "jobs_remixed_from_fkey"
            columns: ["remixed_from"]
            isOneToOne: false
            referencedRelation: "recent_vocal_quality"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "jobs_song_document_id_fkey"
            columns: ["song_document_id"]
            isOneToOne: false
            referencedRelation: "song_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      song_documents: {
        Row: {
          created_at: string
          document_json: Json
          id: string
          language: Database["public"]["Enums"]["language_enum"]
          style_family: Database["public"]["Enums"]["style_family_enum"]
          title: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          document_json: Json
          id?: string
          language: Database["public"]["Enums"]["language_enum"]
          style_family: Database["public"]["Enums"]["style_family_enum"]
          title?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          document_json?: Json
          id?: string
          language?: Database["public"]["Enums"]["language_enum"]
          style_family?: Database["public"]["Enums"]["style_family_enum"]
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "song_documents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "song_documents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      song_likes: {
        Row: {
          created_at: string
          job_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          job_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          job_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "song_likes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "song_likes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "orphan_jobs"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "song_likes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "recent_vocal_quality"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "song_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "song_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      song_reports: {
        Row: {
          created_at: string
          id: string
          job_id: string
          reason: string
          reporter_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          reason: string
          reporter_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          reason?: string
          reporter_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "song_reports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "song_reports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "orphan_jobs"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "song_reports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "recent_vocal_quality"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "song_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "song_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      track_stems: {
        Row: {
          bytes: number | null
          created_at: string
          format: Database["public"]["Enums"]["track_format_enum"]
          id: string
          job_id: string
          kind: string
          url: string
        }
        Insert: {
          bytes?: number | null
          created_at?: string
          format?: Database["public"]["Enums"]["track_format_enum"]
          id?: string
          job_id: string
          kind: string
          url: string
        }
        Update: {
          bytes?: number | null
          created_at?: string
          format?: Database["public"]["Enums"]["track_format_enum"]
          id?: string
          job_id?: string
          kind?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "track_stems_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "track_stems_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "orphan_jobs"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "track_stems_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "recent_vocal_quality"
            referencedColumns: ["job_id"]
          },
        ]
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
          vocal_backend: string | null
          vocal_eval_score: number | null
          vocal_model_version: string | null
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
          vocal_backend?: string | null
          vocal_eval_score?: number | null
          vocal_model_version?: string | null
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
          vocal_backend?: string | null
          vocal_eval_score?: number | null
          vocal_model_version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tracks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "orphan_jobs"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "tracks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "recent_vocal_quality"
            referencedColumns: ["job_id"]
          },
        ]
      }
      user_billing: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          status: string
          stripe_customer_id: string
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          status?: string
          stripe_customer_id: string
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          status?: string
          stripe_customer_id?: string
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_billing_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_billing_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string
          handle: string | null
          id: string
          locale: string | null
          name: string | null
          tier: Database["public"]["Enums"]["tier_enum"]
        }
        Insert: {
          created_at?: string
          email: string
          handle?: string | null
          id: string
          locale?: string | null
          name?: string | null
          tier?: Database["public"]["Enums"]["tier_enum"]
        }
        Update: {
          created_at?: string
          email?: string
          handle?: string | null
          id?: string
          locale?: string | null
          name?: string | null
          tier?: Database["public"]["Enums"]["tier_enum"]
        }
        Relationships: []
      }
      waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
          source: string
          tier: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          source?: string
          tier: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          source?: string
          tier?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      orphan_jobs: {
        Row: {
          attempt_id: string | null
          attempts: number | null
          created_at: string | null
          error: string | null
          finished_at: string | null
          job_id: string | null
          recovered_at: string | null
          song_document_id: string | null
          status: Database["public"]["Enums"]["job_status_enum"] | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_song_document_id_fkey"
            columns: ["song_document_id"]
            isOneToOne: false
            referencedRelation: "song_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      public_profiles: {
        Row: {
          created_at: string | null
          handle: string | null
          id: string | null
        }
        Insert: {
          created_at?: string | null
          handle?: string | null
          id?: string | null
        }
        Update: {
          created_at?: string | null
          handle?: string | null
          id?: string | null
        }
        Relationships: []
      }
      recent_vocal_quality: {
        Row: {
          created_at: string | null
          job_id: string | null
          language: Database["public"]["Enums"]["language_enum"] | null
          style_family: Database["public"]["Enums"]["style_family_enum"] | null
          user_id: string | null
          vocal_backend: string | null
          vocal_eval_score: number | null
          vocal_model_version: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      v_user_storage_bytes: {
        Row: {
          bytes: number | null
          job_id: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "orphan_jobs"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "tracks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "recent_vocal_quality"
            referencedColumns: ["job_id"]
          },
        ]
      }
    }
    Functions: {
      apply_stripe_subscription_state: {
        Args: {
          p_cancel_at_period_end: boolean
          p_creator_price_id: string
          p_current_period_end: string
          p_price_id: string
          p_pro_price_id: string
          p_status: string
          p_stripe_customer_id: string
          p_subscription_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      claim_handle: {
        Args: { p_handle: string }
        Returns: {
          handle: string
        }[]
      }
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
      enqueue_cover_art_job: {
        Args: {
          p_attempt_id?: string
          p_prompt: string
          p_song_id: string
          p_trace_id?: string
        }
        Returns: {
          attempt_id: string
          job_id: string
          status: string
        }[]
      }
      enqueue_song_generation_job: { Args: { payload: Json }; Returns: number }
      gen_public_id: { Args: never; Returns: string }
      join_waitlist: {
        Args: { p_email: string; p_source?: string; p_tier: string }
        Returns: {
          already_on_list: boolean
          joined: boolean
        }[]
      }
      neo_fm_webhook_secret: { Args: never; Returns: string }
      publish_song: {
        Args: { p_job_id: string; p_visibility: string }
        Returns: {
          public_id: string
          published_at: string
          visibility: Database["public"]["Enums"]["song_visibility_enum"]
        }[]
      }
      reconciler_recover_job: {
        Args: { p_job_id: string }
        Returns: {
          attempt_id: string
          job_id: string
          status: Database["public"]["Enums"]["job_status_enum"]
        }[]
      }
      recover_song_job: {
        Args: { p_job_id: string }
        Returns: {
          attempt_id: string
          job_id: string
          status: Database["public"]["Enums"]["job_status_enum"]
        }[]
      }
      rename_song: {
        Args: { p_job_id: string; p_title: string }
        Returns: {
          id: string
          title: string
        }[]
      }
      report_song: {
        Args: { p_job_id: string; p_reason: string }
        Returns: {
          id: string
        }[]
      }
      submit_feedback: {
        Args: { p_body: string; p_referrer?: string; p_subject: string }
        Returns: {
          id: string
        }[]
      }
      toggle_favorite: {
        Args: { p_job_id: string }
        Returns: {
          id: string
          is_favorite: boolean
        }[]
      }
      toggle_follow: {
        Args: { p_followee: string }
        Returns: {
          follower_count: number
          is_following: boolean
        }[]
      }
      toggle_like: {
        Args: { p_job_id: string }
        Returns: {
          is_liked: boolean
          like_count: number
        }[]
      }
      user_concurrent_processing_count: {
        Args: { p_user_id: string }
        Returns: number
      }
      user_jobs_count_month: { Args: { p_user_id: string }; Returns: number }
      user_jobs_count_today: { Args: { p_user_id: string }; Returns: number }
      user_storage_bytes: { Args: { p_user_id: string }; Returns: number }
      user_tier_concurrent_cap: { Args: { p_user_id: string }; Returns: number }
      user_tier_quota: { Args: { p_user_id: string }; Returns: number }
      user_tier_storage_bytes_cap: {
        Args: { p_user_id: string }
        Returns: number
      }
    }
    Enums: {
      job_status_enum: "queued" | "processing" | "completed" | "failed"
      language_enum: "en" | "hi" | "kn" | "ta"
      song_visibility_enum: "private" | "unlisted" | "public"
      style_family_enum:
        | "western"
        | "carnatic"
        | "hindustani"
        | "kannada-folk"
        | "kannada-light-classical"
        | "tamil-folk"
      tier_enum: "free" | "creator" | "pro"
      track_format_enum: "wav" | "mp3" | "flac"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      job_status_enum: ["queued", "processing", "completed", "failed"],
      language_enum: ["en", "hi", "kn", "ta"],
      song_visibility_enum: ["private", "unlisted", "public"],
      style_family_enum: [
        "western",
        "carnatic",
        "hindustani",
        "kannada-folk",
        "kannada-light-classical",
        "tamil-folk",
      ],
      tier_enum: ["free", "creator", "pro"],
      track_format_enum: ["wav", "mp3", "flac"],
    },
  },
} as const
