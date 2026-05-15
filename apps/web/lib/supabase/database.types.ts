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
          public_id: string | null
          published_at: string | null
          published_visibility: Database["public"]["Enums"]["song_visibility_enum"]
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
          public_id?: string | null
          published_at?: string | null
          published_visibility?: Database["public"]["Enums"]["song_visibility_enum"]
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
          public_id?: string | null
          published_at?: string | null
          published_visibility?: Database["public"]["Enums"]["song_visibility_enum"]
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
        Relationships: [
          {
            foreignKeyName: "song_documents_user_id_fkey"
            columns: ["user_id"]
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
            referencedRelation: "users"
            referencedColumns: ["id"]
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
        Relationships: [
          {
            foreignKeyName: "tracks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
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
    }
    Views: {
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
        ]
      }
    }
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
      gen_public_id: { Args: never; Returns: string }
      publish_song: {
        Args: { p_job_id: string; p_visibility: string }
        Returns: {
          public_id: string
          published_at: string
          visibility: Database["public"]["Enums"]["song_visibility_enum"]
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
      language_enum: "en" | "hi" | "kn"
      song_visibility_enum: "private" | "unlisted" | "public"
      style_family_enum: "western" | "carnatic" | "hindustani" | "kannada-folk"
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
      language_enum: ["en", "hi", "kn"],
      song_visibility_enum: ["private", "unlisted", "public"],
      style_family_enum: ["western", "carnatic", "hindustani", "kannada-folk"],
      tier_enum: ["free", "creator", "pro"],
      track_format_enum: ["wav", "mp3", "flac"],
    },
  },
} as const
