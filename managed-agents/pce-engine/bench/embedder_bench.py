import numpy as np, onnxruntime as ort, sys
from tokenizers import Tokenizer
sys.path.insert(0,'/home/user/neo-fm/services/embedder')
def load(path_model, path_tok, pad):
    s=ort.InferenceSession(path_model,providers=["CPUExecutionProvider"])
    t=Tokenizer.from_file(path_tok); t.enable_truncation(max_length=256); t.enable_padding(pad_id=t.token_to_id(pad) or 0,pad_token=pad)
    return s,t
def run(s,t,texts,pool):
    enc=t.encode_batch(texts); ids=np.array([e.ids for e in enc],dtype=np.int64); m=np.array([e.attention_mask for e in enc],dtype=np.int64)
    feeds={"input_ids":ids,"attention_mask":m}
    names=[i.name for i in s.get_inputs()]
    if "token_type_ids" in names: feeds["token_type_ids"]=np.zeros_like(ids)
    outs=s.run(None,feeds)
    onames=[o.name for o in s.get_outputs()]
    if pool=="sentence" and "sentence_embedding" in onames: v=outs[onames.index("sentence_embedding")]
    else:
        h=outs[0]; mm=m[...,None].astype(np.float32); v=(h*mm).sum(1)/np.clip(mm.sum(1),1e-9,None)
    return v/np.clip(np.linalg.norm(v,axis=1,keepdims=True),1e-9,None)
# (aspect/query in English, positive lyric line, hard-negative lyric lines in other themes), per language
DATA={
"kn":[("longing for home","ಮಳೆ ಬಂತು ಮನೆ ನೆನಪಾಯ್ತು ಅಮ್ಮನ ಸೆರಗಿನ ಘಮ ಗಾಳಿಯಲಿ","ಕ್ರಿಕೆಟ್ ಪಂದ್ಯದಲ್ಲಿ ನಮ್ಮ ತಂಡ ಗೆದ್ದಿತು"),("devotion to the goddess","ತಾಯಿ ಚಾಮುಂಡಿ ನಿನ್ನ ಪಾದಕೆ ನಮಿಸುವೆ ಕಾಪಾಡು","ಮಾರುಕಟ್ಟೆಯಲ್ಲಿ ತರಕಾರಿ ಬೆಲೆ ಏರಿದೆ"),("dawn over the temple tank","ಬೆಳಗಿನ ಕಿರಣ ಕೊಳದ ಮೇಲೆ ಚಿನ್ನ ಚೆಲ್ಲಿತು ಗುಡಿಯ ಘಂಟೆ ಮೊಳಗಿತು","ರೈಲು ನಿಲ್ದಾಣದಲ್ಲಿ ಜನಸಂದಣಿ ಇತ್ತು")],
"ta":[("longing for home","மழை வந்ததும் என் வீடு நினைவுக்கு வந்தது அம்மாவின் மணம் காற்றில்","கிரிக்கெட் போட்டியில் அணி வெற்றி பெற்றது"),("harvest festival joy","பொங்கல் பானை பொங்கி வழிய உழவர் மகிழ்ந்து பாடினர்","அலுவலக கூட்டம் நாளை காலை நடைபெறும்"),("a mother's lullaby","கண்ணே கண்ணுறங்கு அம்மா பாடுவேன் தாலாட்டு","பங்குச் சந்தை இன்று சரிந்தது")],
"te":[("longing for home","వర్షం కురిసింది ఇంటి జ్ఞాపకం వచ్చింది అమ్మ చీర వాసన గాలిలో","క్రికెట్ మ్యాచ్‌లో మన జట్టు గెలిచింది"),("devotion to Lord Rama","రామ నామ జపము చేయుచుండె మనసు భక్తితో","బ్యాంకు వడ్డీ రేట్లు పెరిగాయి"),("spring blossoms","వసంతం వచ్చింది మామిడి పూలు విరిసాయి కోకిల పాడింది","ట్రాఫిక్ జామ్ వల్ల ఆలస్యమైంది")],
"hi":[("longing for home","बारिश आई तो घर की याद आई माँ के आँचल की खुशबू हवा में","क्रिकेट मैच में हमारी टीम जीत गई"),("love under the monsoon","भीगी सड़कों पर तेरा इंतज़ार करता रहा बादल गरजे","शेयर बाज़ार आज गिर गया"),("devotion to Krishna","मुरली की धुन पर नाचे राधा कृष्ण के संग","दफ्तर की बैठक कल सुबह होगी")],
"bn":[("longing for home","বৃষ্টি এলো ঘরের কথা মনে পড়লো মায়ের আঁচলের গন্ধ হাওয়ায়","ক্রিকেট ম্যাচে আমাদের দল জিতেছে"),("rain and the river","নদীর বুকে বৃষ্টি ঝরে সন্ধ্যা নামে ধীরে","শেয়ার বাজার আজ পড়ে গেছে"),("autumn festival","শরতের আকাশে কাশফুল দুর্গাপূজার ঢাক বাজে","অফিসের মিটিং কাল সকালে")],
}
def evaluate(name,enc):
    ok=0;n=0;margins=[]
    for lang,items in DATA.items():
        for idx,(q,pos,neg) in enumerate(items):
            # cross-lingual: English aspect vs poem line (positive should beat unrelated negative)
            qv=enc("query",[q]); dv=enc("doc",[pos,neg,*[its[j][1] for l2,its in DATA.items() if l2!=lang for j in range(3) if j!=idx and j!=0 and idx!=0]])
            s=(qv@dv.T)[0]; n+=1; ok+= int(s[0]>s[1:].max()); margins.append(float(s[0]-s[1:].max()))
    print(f"{name}: top1 {ok}/{n}  mean margin {np.mean(margins):.3f}")
# e5
s1,t1=load('/models/e5/model_quantized.onnx','/models/e5/tokenizer.json','<pad>')
evaluate("e5-small",lambda k,x: run(s1,t1,[("query: " if k=="query" else "passage: ")+a for a in x],"mean"))
s2,t2=load('/models/gemma/model_quantized.onnx','/models/gemma/tokenizer.json','<pad>')
print([o.name for o in s2.get_outputs()])
evaluate("embeddinggemma-300m",lambda k,x: run(s2,t2,[("task: search result | query: " if k=="query" else "title: none | text: ")+a for a in x],"sentence"))
