# Tamarin 1.12.0 and Maude 3.5.1, each pinned by its release's SHA-256.
# Built by check.sh as seedelf-messaging-tamarin:1.12.0.
FROM docker.io/library/ubuntu:24.04@sha256:9c7f200c07e3d4a03e7249d2c16bf66a51120fb876aa2242cf31451412543289
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl ca-certificates unzip libgmp10 libffi8 zlib1g \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /tmp/maude.zip https://github.com/maude-lang/Maude/releases/download/Maude3.5.1/Maude-3.5.1-linux-x86_64.zip \
 && echo "72ed1ca87e3b3d0dfc6ee1436baf154bf04c45ff97d521bec040c5e8dfc8f92c  /tmp/maude.zip" | sha256sum -c - \
 && mkdir -p /opt/maude && unzip -q /tmp/maude.zip -d /opt/maude && rm /tmp/maude.zip \
 && ln -s /opt/maude/maude /usr/local/bin/maude \
 && for f in /opt/maude/*.maude; do ln -s "$f" /usr/local/bin/; done
RUN curl -fsSL -o /tmp/tamarin.tgz https://github.com/tamarin-prover/tamarin-prover/releases/download/1.12.0/tamarin-prover-1.12.0-linux64-ubuntu.tar.gz \
 && echo "201be06f469e47cff554df6ca93db8366fc2c69d70c61fcbd1370a1074b469c6  /tmp/tamarin.tgz" | sha256sum -c - \
 && mkdir -p /opt/tamarin && tar -xzf /tmp/tamarin.tgz -C /opt/tamarin && rm /tmp/tamarin.tgz \
 && ln -s "$(find /opt/tamarin -name tamarin-prover -type f)" /usr/local/bin/tamarin-prover \
 && maude --version && tamarin-prover --version
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8
ENTRYPOINT ["tamarin-prover"]
