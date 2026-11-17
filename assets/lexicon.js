// Vocabulario propio para la predicción en línea: palabras de uso común en prompts, profesiones y
// términos técnicos que la lista de frecuencias general (lexicon-freq.js) no trae o trae con poco peso.
(function () {
  const comunes = `
de la que el en y a los se del las un por con no una su para es al lo como más o pero sus le ha me si sin sobre este ya entre
cuando todo esta ser son dos también fue había era muy años hasta desde está mi porque qué solo han yo hay vez puede todos así
nos ni parte tiene él uno donde bien tiempo mismo ese ahora cada e vida otro después te otros aunque esa eso hace otra gobierno
tan durante siempre día tanto ella tres sí dijo sido gran país según menos mundo año antes estado contra sino forma caso nada
hacer general estaba poco estos presidente mayor ante unos les algo hacia casa ellos ayer hecho primera mucho mientras además
quien momento millones esto hombre están pues hoy lugar nacional trabajo otras mejor nuevo decir algunos entonces
todas días debe política cómo casi toda tal luego pasado primer medio va estas sea tenía nunca poder aquí ver veces embargo partido
personas grupo cuenta pueden tienen misma nueva cual fueron mujer frente tras cosas fin ciudad he social manera tener sistema
será historia muchos tipo cuatro dentro nuestro punto dice ello cualquier noche aún agua parece haber situación fuera bajo
grandes nuestra ejemplo acuerdo habían usted estados hizo nadie países horas posible tarde ley importante guerra desarrollo
proceso realidad sentido lado mí tu cambio allí mano eran estar número sociedad unas centro padre gente final relación cuerpo
obra incluso través último madre mis modo problema cinco hombres información ojos muerte nombre algunas público mujeres
siglo todavía meses mañana esos nosotros hora muchas pueblo alguna dar problemas don da tú derecho verdad unidos podría
sería junto cabeza aquel cuanto tierra equipo segundo director dicho cierto casos manos nivel podía familia largo partir falta
llegar propio ministro cosa primero seguridad hemos mal trata algún tuvo respecto semana varios real sé voz paso señor mil
quienes proyecto mercado mayoría luz claro iba éxito propia sector actual lleva medida libro estudio mejores amor decisión
calidad empresa empresas servicio servicios cliente clientes usuario usuarios producto productos datos análisis resultado
resultados objetivo objetivos plan estrategia mercado ventas costo costos precio precios valor tiempo forma manera paso pasos
idea ideas tema temas texto textos documento documentos archivo archivos pregunta preguntas respuesta respuestas lista tabla
párrafo párrafos frase frases palabra palabras ejemplo ejemplos detalle detalles resumen contenido formato estructura título
títulos sección secciones capítulo punto puntos tono estilo nivel público audiencia lector lectores contexto rol tarea tareas
regla reglas límite límites restricción restricciones criterio criterios fuente fuentes referencia referencias opción opciones
alternativa alternativas ventaja ventajas desventaja desventajas riesgo riesgos beneficio beneficios oportunidad oportunidades
necesidad necesidades requisito requisitos función funciones característica características herramienta herramientas recurso
recursos método métodos técnica técnicas modelo modelos práctica prácticas solución soluciones mejora mejoras error errores
`;
  const verbos = `
genera generar crea crear escribe escribir redacta redactar analiza analizar resume resumir explica explicar describe describir
compara comparar evalúa evaluar revisa revisar mejora mejorar corrige corregir traduce traducir propón proponer sugiere sugerir
identifica identificar clasifica clasificar organiza organizar ordena ordenar lista listar enumera enumerar diseña diseñar
desarrolla desarrollar implementa implementar optimiza optimizar define definir calcula calcular estima estimar planifica
planificar prioriza priorizar recomienda recomendar justifica justificar argumenta argumentar convierte convertir adapta adaptar
reescribe reescribir simplifica simplificar extrae extraer detecta detectar verifica verificar valida validar investiga
investigar elabora elaborar prepara preparar construye construir programa programar documenta documentar responde responder
pregunta preguntar indica indicar señala señalar destaca destacar incluye incluir usa usar utiliza utilizar evita evitar
mantén mantener considera considerar asume asumir actúa actuar sigue seguir aplica aplicar entrega entregar presenta presentar
muestra mostrar ayuda ayudar ayúdame necesito quiero busco tengo estoy estás trabajando creando preparando buscando tratando
intentando haciendo usando aprendiendo enseñando escribiendo desarrollando necesita necesitan quiere quieren debe deben debes
puedes podrías deberías sé eres actúa toma adopta cuenta incluyendo considerando manteniendo evitando usando siguiendo
basado basada basados basadas enfocado enfocada orientado orientada dirigido dirigida centrado centrada relacionado relacionada
`;
  const adjetivos = `
claro clara claros claras breve breves conciso concisa concisos detallado detallada detallados detalladas completo completa
simple simples sencillo sencilla práctico práctica prácticos prácticas útil útiles concreto concreta concretos concretas
específico específica específicos específicas profesional profesionales formal informal cercano cercana amable directo directa
técnico técnica técnicos técnicas creativo creativa original originales riguroso rigurosa preciso precisa exacto exacta
correcto correcta adecuado adecuada relevante relevantes principal principales clave nuevo nueva nuevos nuevas actual actuales
moderno moderna eficiente eficientes efectivo efectiva seguro segura sostenible escalable accesible responsivo responsiva
numerada numerado numeradas máximo máxima mínimo mínima breve extenso extensa corto corta largo larga paso estructurado
estructurada ordenado ordenada experto experta senior junior avanzado avanzada básico básica intermedio intermedia
paciente didáctico didáctica meticuloso meticulosa crítico crítica estratégico estratégica analítico analítica
`;
  const dominio = `
aplicación aplicaciones app web sitio página páginas código función funciones clase clases componente componentes interfaz
diseño usuario usuarios pantalla pantallas botón botones formulario formularios campo campos base datos servidor api
backend frontend móvil escritorio navegador javascript typescript python swift swiftui html css react node sql json markdown
github git repositorio despliegue pruebas prueba test tests rendimiento seguridad accesibilidad arquitectura framework librería
dependencias versión versiones configuración instalación documentación comentarios variables variable algoritmo lógica
negocio negocios marketing ventas cliente clientes campaña campañas marca redes sociales contenido publicación publicaciones
correo correos email newsletter anuncio anuncios público objetivo embudo conversión métricas indicadores kpi presupuesto
finanzas financiero financiera inversión ingresos gastos rentabilidad flujo caja contabilidad impuestos factura informe
informes reporte reportes presentación diapositivas propuesta propuestas contrato contratos cláusula cláusulas legal jurídico
jurídica normativa ley leyes artículo artículos abogado abogada derecho derechos obligaciones chile chileno chilena
educación clase clases curso cursos estudiante estudiantes alumno alumnos profesor profesora docente aprendizaje evaluación
rúbrica actividad actividades ejercicio ejercicios lección lecciones currículo nivel básica media universidad
salud médico médica paciente pacientes síntomas tratamiento diagnóstico nutrición ejercicio bienestar
investigación estudio estudios hipótesis metodología encuesta entrevistas muestra variables conclusiones bibliografía
historia cuento relato novela personaje personajes guion poema narrativa escena diálogo
recursos humanos equipo equipos liderazgo reunión reuniones proceso procesos procedimiento protocolo política políticas
producto productos lanzamiento estrategia competencia competidores ventaja diferenciación propuesta valor
prompt prompts inteligencia artificial ia modelo lenguaje chatgpt claude gemini instrucciones ingeniería
paso pasos etapa etapas fase fases semana semanas mes meses plazo plazos cronograma calendario hito hitos
español inglés idioma traducción tono profesional cercano formal amigable persuasivo neutral
`;
  const profesiones = `
contador contadora auditor auditora abogado abogada ingeniero ingeniera arquitecto arquitecta médico médica enfermero
enfermera profesor profesora docente psicólogo psicóloga nutricionista kinesiólogo kinesióloga dentista veterinario
veterinaria periodista diseñador diseñadora desarrollador desarrolladora programador programadora analista consultor
consultora asesor asesora gerente gerenta director directora jefe jefa supervisor supervisora coordinador coordinadora
administrador administradora ejecutivo ejecutiva vendedor vendedora corredor corredora tasador tasadora economista
estadístico estadística investigador investigadora científico científica traductor traductora redactor redactora editor
editora escritor escritora guionista fotógrafo fotógrafa publicista emprendedor emprendedora empresario empresaria
especialista técnico técnica tecnólogo operario operaria inspector inspectora mentor mentora coach entrenador entrenadora
reclutador reclutadora planificador planificadora estratega comunicador comunicadora relacionador
`;
  const tecnicos = `
tributación tributario tributaria tributarios tributarias tributo tributos impuesto impuestos iva renta global complementario
declaración declaraciones formulario boleta boletas honorarios factura facturas facturación electrónica crédito débito
fiscal fiscales contable contables contabilidad balance balances auditoría auditorías conciliación bancaria activo activos
pasivo pasivos patrimonio depreciación amortización provisión provisiones remuneración remuneraciones liquidación
liquidaciones cotización cotizaciones previsional previsionales finiquito indemnización retención retenciones
devolución régimen regímenes pyme pymes propyme emprendedores sociedad sociedades limitada anónima giro ejercicio
período mensual anual trimestral semestral estados financieros flujo inventario inventarios costeo margen utilidad
utilidades pérdida pérdidas ingreso egreso egresos presupuesto presupuestos proyección proyecciones
normativa normativas circular circulares reglamento jurisprudencia cumplimiento fiscalización sanción multa multas
jurisdicción tribunal tribunales demanda demandas sentencia arrendamiento arriendo arrendatario arrendador
reclutamiento selección candidato candidatos onboarding desempeño capacitación clima organizacional colaboradores
construcción edificación estructural hormigón especificaciones licitación itemizado cubicación partidas
logística bodega despacho despachos proveedores abastecimiento suministro distribución almacenamiento
hipotecario tasación plusvalía rentabilidad propiedad propiedades departamento inmobiliaria inmobiliario
diagnóstico tratamiento síntomas paciente pacientes clínico clínica terapia terapéutico
`;
  const words = (profesiones + tecnicos + comunes + verbos + adjetivos + dominio).split(/\s+/).filter(Boolean);
  const seen = new Set();
  window.PF_LEXICON_EXTRA = words.filter((w) => !seen.has(w) && seen.add(w));
})();
