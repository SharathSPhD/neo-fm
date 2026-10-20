#!/usr/bin/env python3
"""Stage 1: QLoRA SFT on metrical verse stanzas (spec -> verse). Run on the 5090.
python train/sft_qlora.py --data data/out/stanzas.jsonl --out runs/sft-gemma3-4b [--model unsloth/gemma-3-4b-it]"""
import argparse, os, sys, random
from unsloth import FastLanguageModel  # import first
from unsloth.chat_templates import train_on_responses_only
from datasets import Dataset
from trl import SFTTrainer, SFTConfig
sys.path.insert(0, os.path.dirname(__file__)); import common
ap = argparse.ArgumentParser()
ap.add_argument("--data", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--model", default="unsloth/gemma-3-4b-it"); ap.add_argument("--epochs", type=float, default=1.0)
ap.add_argument("--max-seq", type=int, default=768); ap.add_argument("--lr", type=float, default=1e-4)
ap.add_argument("--max-per-lang", type=int, default=6000); ap.add_argument("--rank", type=int, default=32)
a = ap.parse_args()
rows = common.read_jsonl(a.data); random.Random(0).shuffle(rows)
cnt = {}; keep = []
for r in rows:
    if cnt.get(r["lang"], 0) >= a.max_per_lang: continue
    cnt[r["lang"]] = cnt.get(r["lang"], 0) + 1; keep.append(r)
print("rows per lang", cnt)
model, tok = FastLanguageModel.from_pretrained(a.model, max_seq_length=a.max_seq, load_in_4bit=True)
model = FastLanguageModel.get_peft_model(model, r=a.rank, lora_alpha=a.rank, lora_dropout=0, target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"], use_gradient_checkpointing="unsloth", random_state=0)
def fmt(r):
    msgs = [{"role": "user", "content": common.verse_prompt(r["lang"], r["spec"])}, {"role": "assistant", "content": r["text"]}]
    return {"text": tok.apply_chat_template(msgs, tokenize=False)}
ds = Dataset.from_list(keep).map(fmt, remove_columns=list(keep[0].keys()))
tr = SFTTrainer(model=model, tokenizer=tok, train_dataset=ds, args=SFTConfig(output_dir=a.out, per_device_train_batch_size=4, gradient_accumulation_steps=4,
    num_train_epochs=a.epochs, learning_rate=a.lr, lr_scheduler_type="cosine", warmup_ratio=0.03, logging_steps=10, save_strategy="epoch",
    bf16=True, optim="adamw_8bit", dataset_text_field="text", max_length=a.max_seq, report_to="none", seed=0))
tr = train_on_responses_only(tr, instruction_part="<start_of_turn>user\n", response_part="<start_of_turn>model\n")
tr.train(); model.save_pretrained(a.out + "/adapter"); tok.save_pretrained(a.out + "/adapter"); print("saved", a.out + "/adapter")
