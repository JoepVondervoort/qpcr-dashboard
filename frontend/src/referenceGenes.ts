/** Genes commonly used to normalize qPCR data: HGNC symbols and the usual lab spellings of 18S rRNA. */
const REFERENCE_GENES=new Set(['GAPDH','ACTB','B2M','HPRT1','HPRT','RPL13A','RPL32','RPLP0','RPS18','TBP','GUSB','PPIA','YWHAZ','SDHA',
 'UBC','HMBS','PGK1','TFRC','EEF1A1','C1ORF43','CHMP2A','EMC7','GPI','PSMB2','PSMB4','RAB7A','REEP5','SNRPD3','VCP','VPS29',
 '18S','18SR','18SRRNA','RN18S','RN18S1'])

// "GAPDH 1", "GAPDH_2", "GAPDH-v2": a primer-set number after the gene symbol.
const symbol=(assay:string)=>assay.trim().toUpperCase().replace(/[\s_-]+(?:V|SET)?\d+$/,'').replace(/[\s_-]+/g,'')

export const isReferenceGene=(assay:string)=>REFERENCE_GENES.has(symbol(assay))

/** Suggested reference genes, in the order given. The scientist confirms the choice in Normalization. */
export const suggestReferences=(assays:string[])=>assays.filter(isReferenceGene)
