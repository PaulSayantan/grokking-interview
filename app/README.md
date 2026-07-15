# interview-practice (TUI app)

The Textual-based terminal app for practicing MCQs from the learner's library.

**Status:** scaffolded (package skeleton only). Implementation begins in Phase 2 —
see `../ROADMAP.md`.

## Planned architecture

```
src/interview_practice/
├── __main__.py          # entry point (interview-practice command)
├── core/
│   ├── models.py         # Question, Topic, Domain, QuizSession dataclasses
│   ├── loader.py         # parse ../../topics/**/questions.yaml into models
│   ├── engine.py         # quiz logic: topic/random selection, scoring
│   └── progress.py       # persist score history to ~/.interview-practice/
├── ui/
│   ├── app.py            # Textual App + screen routing
│   ├── screens/          # home, topic_picker, quiz, results
│   └── widgets/          # question card, option list, progress bar
└── data/                 # bundled defaults if any
```

## Dev setup (Phase 2)

```bash
cd app
pip install -e ".[dev]"
interview-practice        # run
textual run --dev src/interview_practice/ui/app.py   # dev mode w/ console
```
