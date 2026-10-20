#!/usr/bin/env python3
"""Stage 2: DPO on mined preference pairs, starting from the SFT adapter. python train/dpo.py --pairs data/pairs.jsonl --adapter runs/sft/adapter --out runs/dpo"""
import argparse, os, sys
from unsloth import FastLanguageModel, PatchDPOTrainer
PatchDPOTrainer()
from datasets import Dataset
from trl import DPOTrainer, DPOConfig
sys.path.insert(0, os.path.dirname(__file__)); import common
ap = argparse.ArgumentParser()
ap.add_argument("--pairs", required=True); ap.add_argument("--adapter", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--beta", type=float, default=0.1); ap.add_argument("--epochs", type=float, default=1.0); ap.add_argument("--lr", type=float, default=5e-6)
a = ap.parse_args()
model, tok = FastLanguageModel.from_pretrained(a.adapter, max_seq_length=1024, load_in_4bit=True)
if not hasattr(model, "peft_config"):  # adapter dir already carries trainable LoRA
    model = FastLanguageModel.get_peft_model(model, r=16, lora_alpha=16, lora_dropout=0, target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"], use_gradient_checkpointing="unsloth")
rows = []
for r in common.read_jsonl(a.pairs):
    p = tok.apply_chat_template([{"role": "user", "content": common.song_prompt(r["lang"], r["style"], r["brief"])}], tokenize=False, add_generation_prompt=True)
    rows.append({"prompt": p, "chosen": r["chosen"], "rejected": r["rejected"]})
tr = DPOTrainer(model=model, ref_model=None, processing_class=tok, train_dataset=Dataset.from_list(rows),
    args=DPOConfig(output_dir=a.out, per_device_train_batch_size=2, gradient_accumulation_steps=8, num_train_epochs=a.epochs, learning_rate=a.lr, beta=a.beta,
                   logging_steps=5, bf16=True, optim="adamw_8bit", max_length=768, report_to="none", seed=0))
tr.train(); model.save_pretrained(a.out + "/adapter"); tok.save_pretrained(a.out + "/adapter"); print("saved")
