# Plataforma Campo Digital — documentación para colaboración

[Documentación técnica canónica](../../platform/README.md)

Esta carpeta resume en español el estado y las decisiones importantes de la
plataforma para Campo Digital.

La documentación técnica canónica se mantiene en inglés. Los documentos en
español explican la misma dirección para colaboración, reuniones y decisiones
operativas; no crean una segunda arquitectura independiente.

## Documentos

- [Estado actual de la plataforma](estado-plataforma.md)

## Productos

La plataforma reúne tres productos separados:

1. LiDAR / Cubicación
2. Gestión Predial Forestal / QGIS
3. Transelec

La plataforma compartirá acceso, infraestructura, trazabilidad y navegación,
pero cada producto mantiene su propia lógica.

## Idea central

El objetivo no es solamente subir archivos desde distintos computadores a un
servidor.

Queremos pasar de:

```text
archivos dispersos
+ versiones locales
+ planillas
+ HTML generados
```

a:

```text
fuentes de trabajo conocidas
        |
        v
ingesta controlada
        |
        +-- archivos originales preservados
        |
        +-- base de datos canónica e historial
        |
        v
plataforma Campo Digital
        |
        +-- LiDAR
        +-- Forestal
        +-- Transelec
```

OneDrive puede seguir siendo una herramienta familiar de colaboración, pero no
debe funcionar como base de datos de producción.

## Etapa actual

Por ahora el desarrollo seguirá siendo local.

La prioridad es construir correctamente:

- PostgreSQL/PostGIS local;
- migraciones;
- snapshots y proveniencia;
- almacenamiento de artefactos;
- seguridad base;
- integración de LiDAR;
- contratos de Forestal y Transelec;
- y finalmente el portal de empresa.

La infraestructura productiva se contratará cuando exista una necesidad real
de acceso compartido.
