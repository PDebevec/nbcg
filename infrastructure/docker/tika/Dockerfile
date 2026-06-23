FROM apache/tika:3.3.1.0-full

USER root

RUN groupadd -r tika && useradd -r -g tika tika

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        tesseract-ocr-eng \
        tesseract-ocr-bos \
        tesseract-ocr-bul \
        tesseract-ocr-ell \
        tesseract-ocr-hrv \
        tesseract-ocr-hun \
        tesseract-ocr-mkd \
        tesseract-ocr-ron \
        tesseract-ocr-rus \
        tesseract-ocr-slv \
        tesseract-ocr-sqi \
        tesseract-ocr-srp \
        tesseract-ocr-tur \
        tesseract-ocr-script-cyrl \
        tesseract-ocr-script-latn && \
    rm -rf /var/lib/apt/lists/*

USER tika