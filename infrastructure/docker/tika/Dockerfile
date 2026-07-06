FROM apache/tika:3.3.1.0-full

USER root

RUN groupadd -r tika && useradd -r -g tika tika

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        tesseract-ocr-eng \
        tesseract-ocr-ara \
        tesseract-ocr-bos \
        tesseract-ocr-bul \
        tesseract-ocr-ces \
        tesseract-ocr-deu \
        tesseract-ocr-ell \
        tesseract-ocr-fra \
        tesseract-ocr-hrv \
        tesseract-ocr-hun \
        tesseract-ocr-ita \
        tesseract-ocr-lat \
        tesseract-ocr-mkd \
        tesseract-ocr-pol \
        tesseract-ocr-por \
        tesseract-ocr-ron \
        tesseract-ocr-rus \
        tesseract-ocr-slv \
        tesseract-ocr-spa \
        tesseract-ocr-sqi \
        tesseract-ocr-srp \
        tesseract-ocr-tur \
        tesseract-ocr-script-cyrl \
        tesseract-ocr-script-latn && \
    rm -rf /var/lib/apt/lists/*

# Serbian Latin model — not packaged for Debian (only tesseract-ocr-srp, which is
# Cyrillic). Fetch it straight from the official tessdata repo. World-readable so the
# unprivileged "tika" user can load it. Tika's X-Tika-OCRLanguage validator accepts
# the "srp_latn" token but rejects the capitalized "Latin"/"Cyrillic" script names.
ADD --chmod=644 https://github.com/tesseract-ocr/tessdata/raw/main/srp_latn.traineddata \
    /usr/share/tesseract-ocr/5/tessdata/srp_latn.traineddata

# Raise the forked-process parse timeout (default 5 min) so large scanned PDFs finish OCR.
COPY tika-config.xml /tika-config.xml

USER tika